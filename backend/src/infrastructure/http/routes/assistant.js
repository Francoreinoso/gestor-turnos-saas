import express from 'express';
import { randomUUID } from 'crypto';
import { db } from '../../db/client.js';
import * as repos from '../../db/repositories/index.js';
import assistantAuth, { SESSION_AUDIENCE } from '../middleware/assistantAuth.js';
import { uuidParams } from '../middleware/uuidParams.js';
import {
  assistantCodeLimiter, assistantVerifyLimiter, assistantMessageIpLimiter, assistantMessageClientLimiter,
} from '../middleware/limiters.js';
import { signAssistantToken } from '../jwt.js';
import { encodeConversation, decodeConversation } from '../assistantConversation.js';
import { LlmUnavailableError } from '../../integrations/llm/port.js';
import { parseInput } from '../../../domain/validation.js';
import { startSessionBody, verifySessionBody, messageBody } from '../../../domain/schemas/assistant.js';
import { SESSION_TTL_SECONDS, MAX_CONVERSATION_MESSAGES, countClientMessages } from '../../../domain/assistant.js';
import { startSession } from '../../../application/assistant/startSession.js';
import { verifySession } from '../../../application/assistant/verifySession.js';
import { runAssistantTurn } from '../../../application/assistant/runAssistantTurn.js';
import { confirmProposal } from '../../../application/assistant/confirmProposal.js';

// spec 011 — asistente de IA para el cliente final. El cliente LLM y el envío de códigos se inyectan en
// createApp (app.locals.assistant): los tests usan un LLM falso y `npm test` nunca llama a un proveedor real.

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

uuidParams(router);

// RNF-2: sin el proveedor configurado, todo /assistant/* responde 503 y el resto de la app funciona.
// Va en cada ruta (no router.use) para que un :id mal formado siga respondiendo 404 antes que nada (spec 008).
const requireAssistant = (req, res, next) =>
  req.app.locals.assistant?.llm ? next() : res.status(503).json({ error: 'assistant_unavailable' });

// RF-18: límite de uso, red, timeout o 5xx del proveedor → 503 sin su detalle; la causa solo va al log.
const providerError = (err) => {
  console.error(`[assistant] proveedor no disponible (${err.code}):`, err.cause?.status ?? err.cause?.name ?? 'sin detalle');
  return httpErr(503, err.code);
};

// RF-1, RF-4 — pide el código. Respuesta idéntica exista o no el cliente.
router.post('/session', requireAssistant, assistantCodeLimiter, wrap(async (req, res) => {
  const { account_id, phone } = parseInput(startSessionBody, req.body);
  res.status(202).json(await startSession(db, { accountId: account_id, phone }, repos, req.app.locals.assistant.sms));
}));

// RF-2, RF-3 — verifica el código y entrega un token de sesión de 1 h.
router.post('/session/verify', requireAssistant, assistantVerifyLimiter, wrap(async (req, res) => {
  const { account_id, phone, code } = parseInput(verifySessionBody, req.body);
  const { accountId, clientId } = await verifySession(db, { accountId: account_id, phone, code }, repos);
  const token = signAssistantToken({ account_id: accountId, client_id: clientId, sid: randomUUID() }, { audience: SESSION_AUDIENCE, expiresIn: SESSION_TTL_SECONDS });
  res.json({ token, expires_in: SESSION_TTL_SECONDS });
}));

// Un mensaje del cliente. El historial llega firmado (`conversation`) y vuelve actualizado y firmado.
router.post('/messages', requireAssistant, assistantMessageIpLimiter, assistantAuth, assistantMessageClientLimiter, wrap(async (req, res) => {
  const { message, conversation } = parseInput(messageBody, req.body);
  const { accountId, clientId, sid, exp } = req.assistant;

  const previous = conversation ? decodeConversation(conversation, sid) : { startedAt: new Date(), messages: [] };
  if (countClientMessages(previous.messages) >= MAX_CONVERSATION_MESSAGES) throw httpErr(429, 'conversation_limit');

  const account = await repos.accounts.findById(db, accountId);
  if (!account) throw httpErr(404, 'not_found');

  let result;
  try {
    result = await runAssistantTurn({
      llm: req.app.locals.assistant.llm, db, repos, accountId, clientId, businessName: account.business_name,
      startedAt: previous.startedAt, messages: previous.messages, userMessage: message,
    });
  } catch (err) {
    if (err instanceof LlmUnavailableError) throw providerError(err);
    throw err;
  }

  res.json({
    reply: result.reply,
    proposals: result.proposals,
    conversation: encodeConversation({ sid, exp, startedAt: previous.startedAt, messages: result.messages }),
  });
}));

// RF-11, RF-12 — el cliente confirma con el botón; no pasa por el modelo. 201 si creó el turno, 200 si ya estaba.
router.post('/proposals/:id/confirm', requireAssistant, assistantMessageIpLimiter, assistantAuth, wrap(async (req, res) => {
  const { accountId, clientId } = req.assistant;
  const result = await confirmProposal(db, { accountId, clientId, proposalId: req.params.id }, repos);
  const { created, ...body } = result;
  res.status(created ? 201 : 200).json(body);
}));

export default router;
