// async-openai against plugboard: a text call, a stream and one tool round trip.
// Run: PLUGBOARD_KEY=<app key> cargo run

use async_openai::{
    config::OpenAIConfig,
    types::chat::{
        ChatCompletionMessageToolCalls, ChatCompletionRequestAssistantMessageArgs,
        ChatCompletionRequestMessage, ChatCompletionRequestToolMessageArgs,
        ChatCompletionRequestUserMessage, ChatCompletionTool, ChatCompletionTools,
        CreateChatCompletionRequestArgs, FunctionObjectArgs,
    },
    Client,
};
use futures::StreamExt;
use serde_json::json;
use std::io::Write;

const MODEL: &str = "fast";

fn user(text: &str) -> ChatCompletionRequestMessage {
    ChatCompletionRequestMessage::User(ChatCompletionRequestUserMessage {
        content: text.into(),
        name: None,
    })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let key =
        std::env::var("PLUGBOARD_KEY").map_err(|_| "set PLUGBOARD_KEY to a plugboard app key")?;
    // Explicit base. OPENAI_BASE_URL is the env var the crate reads (src/config.rs), not OPENAI_API_BASE.
    let config = OpenAIConfig::new()
        .with_api_key(key)
        .with_api_base("http://127.0.0.1:4010/v1");
    let client = Client::with_config(config);

    // 1. Text.
    let req = CreateChatCompletionRequestArgs::default()
        .model(MODEL)
        .max_completion_tokens(1024u32)
        .messages(vec![user("Reply with the single word: pong")])
        .build()?;
    let resp = client.chat().create(req).await?;
    println!(
        "text: {}",
        resp.choices[0].message.content.clone().unwrap_or_default()
    );

    // 2. Stream.
    let req = CreateChatCompletionRequestArgs::default()
        .model(MODEL)
        .max_completion_tokens(1024u32)
        .stream(true)
        .messages(vec![user("Count from 1 to 3, comma separated.")])
        .build()?;
    let mut stream = client.chat().create_stream(req).await?;
    print!("stream: ");
    let mut chunks = 0;
    while let Some(chunk) = stream.next().await {
        for choice in chunk?.choices {
            if let Some(text) = choice.delta.content {
                chunks += 1;
                print!("{text}");
                std::io::stdout().flush()?;
            }
        }
    }
    println!("\nstream chunks with text: {chunks}");

    // 3. One tool round trip.
    let tool = ChatCompletionTools::Function(ChatCompletionTool {
        function: FunctionObjectArgs::default()
            .name("get_weather")
            .description("Get the current weather for a city")
            .parameters(json!({
                "type": "object",
                "properties": { "city": { "type": "string" } },
                "required": ["city"]
            }))
            .build()?,
    });
    let mut messages = vec![user("What is the weather in Lisbon? Use the tool.")];
    let req = CreateChatCompletionRequestArgs::default()
        .model(MODEL)
        .max_completion_tokens(1024u32)
        .messages(messages.clone())
        .tools(vec![tool])
        .build()?;
    let first = client.chat().create(req).await?;
    let calls: Vec<ChatCompletionMessageToolCalls> = first.choices[0]
        .message
        .tool_calls
        .clone()
        .unwrap_or_default();
    let Some(ChatCompletionMessageToolCalls::Function(call)) = calls.first().cloned() else {
        return Err("model did not call get_weather".into());
    };
    println!(
        "tool call: {}({})",
        call.function.name, call.function.arguments
    );

    messages.push(ChatCompletionRequestMessage::Assistant(
        ChatCompletionRequestAssistantMessageArgs::default()
            .tool_calls(calls)
            .build()?,
    ));
    messages.push(ChatCompletionRequestMessage::Tool(
        ChatCompletionRequestToolMessageArgs::default()
            .tool_call_id(call.id)
            .content(r#"{"city":"Lisbon","forecast":"sunny","celsius":24}"#)
            .build()?,
    ));
    let req = CreateChatCompletionRequestArgs::default()
        .model(MODEL)
        .max_completion_tokens(1024u32)
        .messages(messages)
        .build()?;
    let answer = client.chat().create(req).await?;
    println!(
        "tool answer: {}",
        answer.choices[0]
            .message
            .content
            .clone()
            .unwrap_or_default()
    );
    Ok(())
}
