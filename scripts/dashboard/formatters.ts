import type { ActivityStatus } from '../activity-logger.js';

export const formatDashboardDate = (date: Date): string => {
  const formatted = date.toLocaleString('en-GB', {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
  return formatted.replace(/\//g, '-').replace(',', '');
};

export const getStatusEmoji = (status: 'pass' | 'fail' | 'none'): string => {
  switch (status) {
    case 'pass':
      return '&#9989;';
    case 'fail':
      return '&#10060;';
    case 'none':
      return '&#9898;';
  }
};

export const getHealthColor = (score: number): string => {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
};

export const getStatusIcon = (status: ActivityStatus): string => {
  switch (status) {
    case 'success':
      return '&#9989;';
    case 'warning':
      return '&#9888;&#65039;';
    case 'error':
      return '&#10060;';
    case 'info':
      return '&#8505;&#65039;';
  }
};

export const getStatusColor = (status: ActivityStatus): string => {
  switch (status) {
    case 'success':
      return '#22c55e';
    case 'warning':
      return '#f59e0b';
    case 'error':
      return '#ef4444';
    case 'info':
      return '#8b949e';
  }
};

export const getSourceLabel = (source: string): string => {
  const labels: Record<string, string> = {
    'scan-and-configure': 'Scanner',
    'ci-health-check': 'CI Health',
    'factory-watchdog': 'Watchdog',
    'build-dashboard': 'Dashboard',
    'quality-score': 'Quality',
    'self-heal': 'Self-Heal',
  };
  return labels[source] ?? source;
};

export const getSourceColor = (source: string): string => {
  const colors: Record<string, string> = {
    'scan-and-configure': '#58a6ff',
    'ci-health-check': '#f97316',
    'factory-watchdog': '#a855f7',
    'build-dashboard': '#22c55e',
    'quality-score': '#06b6d4',
    'self-heal': '#ec4899',
  };
  return colors[source] ?? '#8b949e';
};

export const formatTimeAgo = (timestamp: string): string => {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const renderProgressBar = (count: number, total: number): string => {
  const pct = Math.round((count / total) * 100);
  const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return `<div class="progress-bar" style="flex:1"><div class="fill" style="width:${pct}%;background:${color}"></div></div><span style="font-size:0.75rem;color:#8b949e;min-width:40px;text-align:right">${count}/${total}</span>`;
};
