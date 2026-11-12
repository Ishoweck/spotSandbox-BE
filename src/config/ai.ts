// Groq model used by the AI chat, support reply suggestions and product
// title/description generation. Groq retires models without much notice
// (llama-3.3-70b-versatile went away in Nov 2026 and every AI call 404'd),
// so it is overridable with GROQ_MODEL on Render without a deploy.
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// gpt-oss is a reasoning model; its thinking counts against max_tokens.
// 'low' keeps short outputs (100-token titles) from being cut off empty.
export const GROQ_REASONING_EFFORT = 'low' as const;
