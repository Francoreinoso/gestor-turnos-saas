// spec 011 RF-17 — ejecuta los casos contra un cliente del puerto llmClient (el real en run.js, uno falso en los tests).
import { runAssistantTurn } from '../src/application/assistant/runAssistantTurn.js';
import { createFixture, ACCOUNT_ID, CLIENT_ID } from './fixture.js';
import { CASES, toolCalls } from './cases.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cuenta tokens y latencia sin tocar el adaptador. Si el proveedor responde ocupado (429 por tokens o pedidos por
// minuto de una capa gratuita), espera y reintenta: un límite de cuota no es un fallo del modelo.
const metered = (llm, { retries = 0, retryDelayMs = 0 } = {}) => {
  const usage = { requests: 0, input_tokens: 0, output_tokens: 0, ms: 0, retries: 0 };
  return {
    usage,
    send: async (req) => {
      for (let attempt = 0; ; attempt++) {
        const t0 = Date.now();
        try {
          const res = await llm.send(req);
          usage.input_tokens += res.usage?.input_tokens ?? 0;
          usage.output_tokens += res.usage?.output_tokens ?? 0;
          return res;
        } catch (err) {
          if (err.code !== 'assistant_busy' || attempt >= retries) throw err;
          usage.retries++;
          await sleep(retryDelayMs);
        } finally {
          usage.requests++;
          usage.ms += Date.now() - t0;
        }
      }
    },
  };
};

export const runCase = async (llm, testCase, retry = {}) => {
  const fixture = createFixture();
  const client = metered(llm, retry);
  let messages = [];
  const callsByTurn = [];
  const replies = [];

  try {
    for (const userMessage of testCase.turns(fixture)) {
      const before = messages.length;
      const result = await runAssistantTurn({
        llm: client, db: null, repos: fixture.repos, accountId: ACCOUNT_ID, clientId: CLIENT_ID,
        businessName: 'Peluquería Eval', startedAt: new Date(), messages, userMessage,
      });
      messages = result.messages;
      callsByTurn.push(toolCalls(messages.slice(before)));
      replies.push({ outcome: result.outcome, reply: result.reply });
    }
  } catch (err) {
    // Un 429 o un corte del proveedor no es un fallo del modelo: se informa aparte.
    return { id: testCase.id, requirement: testCase.requirement, pass: false, error: err.code ?? err.message, replies, usage: client.usage };
  }

  const verdict = testCase.check({ calls: callsByTurn.flat(), callsByTurn, fixture, replies });
  return {
    id: testCase.id, requirement: testCase.requirement, ...verdict, replies,
    tools: callsByTurn.map((turn) => turn.map((c) => `${c.name}${c.isError ? `!${c.result?.error ?? ''}` : ''}`)),
    usage: client.usage,
  };
};

// `pauseMs`: espera entre casos, para no chocar con el límite de pedidos por minuto de una capa gratuita.
// `retries` / `retryDelayMs`: reintentos ante un proveedor ocupado (ver metered).
export const runEvals = async (llm, { only, repeat = 1, pauseMs = 0, retries = 0, retryDelayMs = 0, onResult = () => {} } = {}) => {
  const results = [];
  for (const testCase of CASES.filter((c) => !only || only.includes(c.id))) {
    for (let i = 0; i < repeat; i++) {
      if (results.length && pauseMs) await sleep(pauseMs);
      const result = { ...(await runCase(llm, testCase, { retries, retryDelayMs })), run: i + 1 };
      results.push(result);
      onResult(result);
    }
  }
  return results;
};
