// Runner for the Spring AI example. Started by examples/_harness/run.ts through run.sh, which captures the traffic and
// writes the run. This program marks each scenario on the capture proxy and prints its raw observations; run.sh pipes
// them through examples/_harness/ts/relay.ts, which applies the checks in examples/_shared/scenarios.json. It writes no
// files. The scenarios are the ones in Runner: S1 chat, S2 tool round trip, S3 stream.
//
//   bash run.sh     # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
package example.plugboard.springai;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
  public static void main(String[] args) {
    // The runner exits when it is done: the context closes, and the exit code is the runner's.
    System.exit(SpringApplication.exit(SpringApplication.run(Application.class, args)));
  }
}
