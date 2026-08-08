const TZ = 'Australia/Brisbane';

export function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: TZ, day: 'numeric' }).format(date);
}

export function formatMonthShort(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: TZ, month: 'short' }).format(date);
}

export function formatFullDate(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .replace(/\s/g, '')
    .toLowerCase();
}

export function formatTimeRange(start: Date, end?: Date): string {
  return end ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start);
}
