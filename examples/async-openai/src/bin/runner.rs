// Runner for the async-openai example. Started by examples/_harness/run.ts through run.sh, which captures the traffic and
// writes the run. This program marks each scenario on the capture proxy and prints its raw observations; run.sh pipes
// them through examples/_harness/ts/relay.ts, which applies the checks in examples/_shared/scenarios.json. It writes no
// files. The scenarios are S1 text, S2 tool round trip, S3 stream and S4 streamed tool call, with the prompts in
// scenarios.json.
//
//     bash run.sh     # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
use async_openai::{
    config::OpenAIConfig,
    types::chat::{
        ChatCompletionMessageToolCalls, ChatCompletionRequestAssistantMessageArgs,
        ChatCompletionRequestMessage, ChatCompletionRequestToolMessageArgs,
        ChatCompletionRequestUserMessage, ChatCompletionStreamOptions, ChatCompletionTool,
        ChatCompletionTools, CreateChatCompletionRequestArgs, FinishReason, FunctionObjectArgs,
    },
    Client,
};
use futures::StreamExt;
use serde_json::{json, Value};
use std::error::Error;
use std::io::{Read, Write};
use std::net::TcpStream;

// The version Cargo.lock resolves (`=0.42.2` in Cargo.toml).
const ASYNC_OPENAI_VERSION: &str = "0.42.2";
const TOOL_PROMPT: &str = "What is the weather in Paris? Use the tool.";
const PROMPT: &str = "Reply with exactly: pong";
const TOOL_RESULT: &str = include_str!("../../../_shared/get_weather.result.json");

type Outcome = Result<Value, Box<dyn Error>>;

fn emit(line: Value) {
    println!("{line}");
}

// mark tells the capture proxy a scenario starts. The proxy waits there until earlier requests have finished.
fn mark(scenario: &str, model: &str) -> Result<(), Box<dyn Error>> {
    let url = std::env::var("PLUGBOARD_CAPTURE_URL")
        .map_err(|_| "PLUGBOARD_CAPTURE_URL is not set: run this through examples/_harness/run.ts")?;
    let addr = url.trim_start_matches("http://").trim_end_matches('/').to_string();
    let body = json!({ "scenario": scenario, "model": model }).to_string();
    let mut stream = TcpStream::connect(&addr)?;
    write!(
        stream,
        "POST /__mark HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    if !response.starts_with("HTTP/1.1 2") {
        return Err(format!("capture refused the mark for {scenario} on {model}: {}", response.lines().next().unwrap_or("")).into());
    }
    Ok(())
}

fn client() -> Result<Client<OpenAIConfig>, Box<dyn Error>> {
    // PLUGBOARD_BASE_URL already ends in /v1. OPENAI_BASE_URL is the env var the crate reads, so set it explicitly.
    let config = OpenAIConfig::new()
        .with_api_key(std::env::var("PLUGBOARD_KEY")?)
        .with_api_base(std::env::var("PLUGBOARD_BASE_URL")?);
    Ok(Client::with_config(config))
}

fn user(text: &str) -> ChatCompletionRequestMessage {
    ChatCompletionRequestMessage::User(ChatCompletionRequestUserMessage {
        content: text.into(),
        name: None,
    })
}

// A finish reason as its wire name ("stop", "tool_calls"), or null when the choice has none.
fn reason(finish: &Option<FinishReason>) -> Value {
    finish.map_or(Value::Null, |r| serde_json::to_value(r).unwrap_or(Value::Null))
}

fn weather_tool() -> Result<ChatCompletionTools, Box<dyn Error>> {
    Ok(ChatCompletionTools::Function(ChatCompletionTool {
        function: FunctionObjectArgs::default()
            .name("get_weather")
            .description("Current weather for a city.")
            .parameters(json!({
                "type": "object",
                "properties": { "city": { "type": "string" } },
                "required": ["city"]
            }))
            .build()?,
    }))
}

async fn s1(client: &Client<OpenAIConfig>, model: &str) -> Outcome {
    let req = CreateChatCompletionRequestArgs::default()
        .model(model)
        .max_completion_tokens(1024u32)
        .messages(vec![user(PROMPT)])
        .build()?;
    let resp = client.chat().create(req).await?;
    let choice = &resp.choices[0];
    Ok(json!({
        "text": choice.message.content.clone().unwrap_or_default(),
        "finish_reason": reason(&choice.finish_reason),
        "usage": resp.usage,
    }))
}

async fn s2(client: &Client<OpenAIConfig>, model: &str) -> Outcome {
    let mut messages = vec![user(TOOL_PROMPT)];
    let req = CreateChatCompletionRequestArgs::default()
        .model(model)
        .max_completion_tokens(1024u32)
        .messages(messages.clone())
        .tools(vec![weather_tool()?])
        .build()?;
    let first = client.chat().create(req).await?;
    let finish = reason(&first.choices[0].finish_reason);
    let calls: Vec<ChatCompletionMessageToolCalls> = first.choices[0].message.tool_calls.clone().unwrap_or_default();
    let Some(ChatCompletionMessageToolCalls::Function(call)) = calls.first().cloned() else {
        return Err("model did not call get_weather".into());
    };
    let args: Value = serde_json::from_str(&call.function.arguments)?;
    // The assistant turn goes back as the crate built it, then the result under the same call id.
    messages.push(ChatCompletionRequestMessage::Assistant(
        ChatCompletionRequestAssistantMessageArgs::default().tool_calls(calls).build()?,
    ));
    messages.push(ChatCompletionRequestMessage::Tool(
        ChatCompletionRequestToolMessageArgs::default()
            .tool_call_id(call.id.clone())
            .content(TOOL_RESULT)
            .build()?,
    ));
    let req = CreateChatCompletionRequestArgs::default()
        .model(model)
        .max_completion_tokens(1024u32)
        .messages(messages)
        .tools(vec![weather_tool()?])
        .build()?;
    let second = client.chat().create(req).await?;
    Ok(json!({
        "finish_reason": finish,
        "tool_name": call.function.name,
        "tool_city": args["city"].as_str().unwrap_or_default(),
        "tool_call_id": call.id,
        "final_text": second.choices[0].message.content.clone().unwrap_or_default(),
        "final_finish_reason": reason(&second.choices[0].finish_reason),
    }))
}

async fn s3(client: &Client<OpenAIConfig>, model: &str) -> Outcome {
    let req = CreateChatCompletionRequestArgs::default()
        .model(model)
        .max_completion_tokens(1024u32)
        .stream(true)
        .stream_options(ChatCompletionStreamOptions {
            include_usage: Some(true),
            include_obfuscation: None,
        })
        .messages(vec![user(PROMPT)])
        .build()?;
    let mut stream = client.chat().create_stream(req).await?;
    let (mut text, mut finish, mut usage) = (String::new(), Value::Null, Value::Null);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if let Some(u) = &chunk.usage {
            usage = serde_json::to_value(u)?;
        }
        for choice in &chunk.choices {
            if let Some(part) = &choice.delta.content {
                text.push_str(part);
            }
            if choice.finish_reason.is_some() {
                finish = reason(&choice.finish_reason);
            }
        }
    }
    // The stream ended normally when it reached the end of the iterator; the harness reads the wire for [DONE].
    Ok(json!({ "text": text, "finish_reason": finish, "usage": usage, "done": true }))
}

async fn s4(client: &Client<OpenAIConfig>, model: &str) -> Outcome {
    let req = CreateChatCompletionRequestArgs::default()
        .model(model)
        .max_completion_tokens(1024u32)
        .stream(true)
        .messages(vec![user(TOOL_PROMPT)])
        .tools(vec![weather_tool()?])
        .build()?;
    let mut stream = client.chat().create_stream(req).await?;
    let (mut finish, mut id, mut name, mut arguments) = (Value::Null, None::<String>, String::new(), String::new());
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        for choice in &chunk.choices {
            if choice.finish_reason.is_some() {
                finish = reason(&choice.finish_reason);
            }
            for call in choice.delta.tool_calls.iter().flatten() {
                if let Some(call_id) = &call.id {
                    id = Some(call_id.clone());
                }
                if let Some(function) = &call.function {
                    if let Some(n) = &function.name {
                        name = n.clone();
                    }
                    if let Some(a) = &function.arguments {
                        arguments.push_str(a);
                    }
                }
            }
        }
    }
    let args: Value = serde_json::from_str(&arguments).unwrap_or(Value::Null);
    Ok(json!({
        "finish_reason": finish,
        "tool_name": name,
        "tool_city": args["city"].as_str().unwrap_or_default(),
        "tool_call_id": id,
    }))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let client = client()?;
    emit(json!({ "kind": "client", "name": "async-openai", "version": ASYNC_OPENAI_VERSION, "runtime": { "name": "rust", "version": "1" } }));

    let file: Value = serde_json::from_str(&std::fs::read_to_string("../_shared/scenarios.json")?)?;
    let scenarios = file["scenarios"].as_array().ok_or("scenarios.json has no scenarios")?;
    let covered = ["S1", "S2", "S3", "S4"];
    let planned: Vec<&str> = scenarios.iter().filter_map(|s| s["id"].as_str()).filter(|id| covered.contains(id)).collect();
    emit(json!({ "kind": "plan", "scenarios": planned }));
    for scenario in scenarios {
        let id = scenario["id"].as_str().unwrap_or_default();
        if !covered.contains(&id) {
            continue;
        }
        for model in scenario["models"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            mark(id, model)?;
            let outcome = match id {
                "S1" => s1(&client, model).await,
                "S2" => s2(&client, model).await,
                "S3" => s3(&client, model).await,
                _ => s4(&client, model).await,
            };
            emit(match outcome {
                Ok(observations) => json!({ "kind": "observation", "scenario": id, "model": model, "error": null, "observations": observations }),
                Err(error) => json!({ "kind": "observation", "scenario": id, "model": model, "error": error.to_string(), "observations": {} }),
            });
        }
    }
    emit(json!({ "kind": "done" }));
    Ok(())
}
