import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '../env';

/** Self-hosted OpenAI-compatible gateways take precedence over OpenRouter. */
export const aiAvailable = () => Boolean(env.MAIL_AI_BASE_URL || env.OPENROUTER_API_KEY);

const proxy = () =>
  createOpenAI({
    baseURL: env.MAIL_AI_BASE_URL,
    apiKey: env.MAIL_AI_API_KEY || 'unused',
    compatibility: 'compatible',
  });

const DEFAULT_CHAT_MODEL = 'openai/gpt-4.1';
const DEFAULT_MINI_MODEL = 'openai/gpt-4.1-mini';

const openrouter = () => {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }
  return createOpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    compatibility: 'strict',
    headers: {
      'HTTP-Referer': env.VITE_PUBLIC_APP_URL || 'https://0.email',
      'X-Title': 'Zero',
    },
  });
};

/** Main model: the chat agent, drafting, and anything with tool calls. */
export const chatModel = () =>
  env.MAIL_AI_BASE_URL
    ? proxy().chat(env.MAIL_AI_MODEL || 'claude/claude-haiku-5-5')
    : openrouter().chat(env.OPENROUTER_MODEL || DEFAULT_CHAT_MODEL);

/** Cheap, fast model for small one-shot tasks. */
export const miniModel = () =>
  env.MAIL_AI_BASE_URL
    ? proxy().chat(env.MAIL_AI_MINI_MODEL || env.MAIL_AI_MODEL || 'claude/claude-haiku-5-5')
    : openrouter().chat(env.OPENROUTER_MINI_MODEL || DEFAULT_MINI_MODEL);
