/**
 * notify.ts
 *
 * Push notification system for DevOps-Factory events.
 * Supports Discord, Telegram, Slack, and custom webhooks.
 * Fails silently if no webhook is configured.
 *
 * Usage: import { notify } from './notify.js';
 *        notify('pr_created', { repo, prUrl, patternId, confidence });
 */

import { WEBHOOK_CONFIG, type NotifyEvent } from '../factory.config.js';

interface NotifyPayload {
  repo?: string;
  prUrl?: string;
  prNumber?: number;
  patternId?: string;
  confidence?: number;
  message?: string;
  details?: string;
}

const EVENT_LABELS: Record<NotifyEvent, { emoji: string; title: string }> = {
  pr_created: { emoji: '🔧', title: 'PR Healing Created' },
  auto_merge: { emoji: '✅', title: 'Auto-Merge Enabled' },
  circuit_breaker: { emoji: '🛑', title: 'Circuit Breaker Triggered' },
  healing_failed: { emoji: '❌', title: 'Healing Failed (CI still red)' },
  healing_verified: { emoji: '✨', title: 'Healing Verified (CI green)' },
  repo_promoted: { emoji: '🎓', title: 'Repo Promoted to Graduated' },
  pattern_degraded: { emoji: '⚠️', title: 'Pattern Degraded' },
};

const getWebhookUrl = (): string => {
  return process.env.FACTORY_WEBHOOK_URL || WEBHOOK_CONFIG.url;
};

const isDiscordWebhook = (url: string): boolean => url.includes('discord.com/api/webhooks');

const isTelegramWebhook = (url: string): boolean => url.includes('api.telegram.org/bot');

const isSlackWebhook = (url: string): boolean => url.includes('hooks.slack.com');

const formatMessage = (event: NotifyEvent, payload: NotifyPayload): string => {
  const label = EVENT_LABELS[event];
  const parts: string[] = [`${label.emoji} **${label.title}**`];

  if (payload.repo) parts.push(`**Repo**: ${payload.repo}`);
  if (payload.patternId) parts.push(`**Pattern**: \`${payload.patternId}\``);
  if (payload.confidence !== undefined)
    parts.push(`**Confidence**: ${(payload.confidence * 100).toFixed(0)}%`);
  if (payload.prUrl) parts.push(`**PR**: ${payload.prUrl}`);
  if (payload.message) parts.push(payload.message);
  if (payload.details) parts.push(`> ${payload.details}`);

  return parts.join('\n');
};

const buildRequestBody = (
  url: string,
  event: NotifyEvent,
  payload: NotifyPayload
): { body: string; contentType: string } => {
  const text = formatMessage(event, payload);

  if (isDiscordWebhook(url)) {
    return {
      body: JSON.stringify({ content: text }),
      contentType: 'application/json',
    };
  }

  if (isTelegramWebhook(url)) {
    // Telegram expects chat_id in the URL params, message in body
    return {
      body: JSON.stringify({
        text: text.replace(/\*\*/g, '*'), // Telegram uses single asterisks for bold
        parse_mode: 'Markdown',
      }),
      contentType: 'application/json',
    };
  }

  if (isSlackWebhook(url)) {
    return {
      body: JSON.stringify({
        text: text.replace(/\*\*/g, '*'), // Slack uses single asterisks
      }),
      contentType: 'application/json',
    };
  }

  // Generic webhook: send JSON payload with event metadata
  return {
    body: JSON.stringify({
      event,
      ...payload,
      text,
      timestamp: new Date().toISOString(),
    }),
    contentType: 'application/json',
  };
};

/**
 * Send a notification for a DevOps-Factory event.
 * Fails silently if no webhook is configured or if the event is not enabled.
 */
export const notify = async (event: NotifyEvent, payload: NotifyPayload): Promise<void> => {
  const url = getWebhookUrl();
  if (!url) return; // No webhook configured — silent no-op
  if (!WEBHOOK_CONFIG.enabled) return;
  if (!WEBHOOK_CONFIG.events.includes(event)) return;

  const { body, contentType } = buildRequestBody(url, event, payload);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(`  [NOTIFY] Webhook failed: ${response.status} ${response.statusText}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  [NOTIFY] Webhook error: ${message}`);
  }
};
