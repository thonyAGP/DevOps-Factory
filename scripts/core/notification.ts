import { execSync } from 'node:child_process';
import { GITHUB_OWNER, NOTIFICATION_CHANNELS } from './config.js';

export type NotificationLevel = 'info' | 'warn' | 'error' | 'critical';

export type NotificationChannel = 'github-issue' | 'email' | 'discord' | 'ntfy';

export interface NotificationMessage {
  title: string;
  body: string;
  level: NotificationLevel;
  repo?: string;
}

const LEVEL_CHANNELS: Record<NotificationLevel, NotificationChannel[]> = {
  info: ['github-issue'],
  warn: ['github-issue', 'discord'],
  error: ['github-issue', 'discord', 'email', 'ntfy'],
  critical: ['github-issue', 'discord', 'email', 'ntfy'],
};

const LEVEL_LABELS: Record<NotificationLevel, string> = {
  info: 'info',
  warn: 'warning',
  error: 'alert',
  critical: 'critical',
};

const sendGithubIssue = (msg: NotificationMessage): void => {
  const repo = msg.repo ?? `${GITHUB_OWNER}/DevOps-Factory`;
  const label = LEVEL_LABELS[msg.level];
  try {
    execSync(
      `gh issue create --repo ${repo} --title "${msg.title}" --body "${msg.body}" --label "${label}"`,
      { encoding: 'utf-8', timeout: 15_000, stdio: 'pipe' }
    );
  } catch (err) {
    console.error(`[notify] Failed to create GitHub issue: ${(err as Error).message}`);
  }
};

const sendDiscord = (msg: NotificationMessage): void => {
  const webhookUrl = process.env['DISCORD_WEBHOOK_URL'];
  if (!webhookUrl) {
    console.warn('[notify] DISCORD_WEBHOOK_URL not set, skipping Discord notification');
    return;
  }

  const emoji =
    msg.level === 'critical'
      ? '🚨'
      : msg.level === 'error'
        ? '❌'
        : msg.level === 'warn'
          ? '⚠️'
          : 'ℹ️';
  const payload = JSON.stringify({
    content: `${emoji} **${msg.title}**\n${msg.body}`,
  });

  try {
    execSync(
      `node -e "const https=require('https');const u=new URL('${webhookUrl}');const r=https.request({hostname:u.hostname,path:u.pathname,method:'POST',headers:{'Content-Type':'application/json'}});r.write(${JSON.stringify(payload)});r.end()"`,
      { timeout: 10_000, stdio: 'pipe' }
    );
  } catch (err) {
    console.error(`[notify] Discord notification failed: ${(err as Error).message}`);
  }
};

const sendNtfy = (msg: NotificationMessage): void => {
  const topic = process.env['NTFY_TOPIC'];
  if (!topic) {
    console.warn('[notify] NTFY_TOPIC not set, skipping ntfy notification');
    return;
  }

  try {
    execSync(
      `node -e "const https=require('https');const r=https.request({hostname:'ntfy.sh',path:'/${topic}',method:'POST',headers:{'Title':'${msg.title.replace(/'/g, '')}','Priority':'${msg.level === 'critical' ? 'urgent' : 'default'}'}});r.write('${msg.body.replace(/'/g, '').slice(0, 500)}');r.end()"`,
      { timeout: 10_000, stdio: 'pipe' }
    );
  } catch (err) {
    console.error(`[notify] ntfy notification failed: ${(err as Error).message}`);
  }
};

const sendEmail = (msg: NotificationMessage): void => {
  const smtpConfig = process.env['SMTP_URL'];
  if (!smtpConfig) {
    console.warn('[notify] SMTP_URL not set, skipping email notification');
    return;
  }
  // Email sending via SMTP would be implemented with nodemailer if needed
  console.log(`[notify] Email: ${msg.title} (SMTP not yet implemented)`);
};

const channelSenders: Record<NotificationChannel, (msg: NotificationMessage) => void> = {
  'github-issue': sendGithubIssue,
  discord: sendDiscord,
  ntfy: sendNtfy,
  email: sendEmail,
};

export const notify = (msg: NotificationMessage, channels?: NotificationChannel[]): void => {
  const targetChannels = channels ?? LEVEL_CHANNELS[msg.level];

  for (const channel of targetChannels) {
    const isEnabled =
      channel === 'github-issue'
        ? NOTIFICATION_CHANNELS.githubIssue
        : channel === 'discord'
          ? NOTIFICATION_CHANNELS.discord
          : channel === 'ntfy'
            ? NOTIFICATION_CHANNELS.ntfy
            : channel === 'email'
              ? NOTIFICATION_CHANNELS.email
              : false;

    if (!isEnabled && !channels) continue;

    const sender = channelSenders[channel];
    if (sender) {
      try {
        sender(msg);
      } catch (err) {
        console.error(`[notify] Channel ${channel} failed: ${(err as Error).message}`);
      }
    }
  }
};

export const notifyInfo = (title: string, body: string, repo?: string): void =>
  notify({ title, body, level: 'info', repo });

export const notifyWarn = (title: string, body: string, repo?: string): void =>
  notify({ title, body, level: 'warn', repo });

export const notifyError = (title: string, body: string, repo?: string): void =>
  notify({ title, body, level: 'error', repo });

export const notifyCritical = (title: string, body: string, repo?: string): void =>
  notify({ title, body, level: 'critical', repo });
