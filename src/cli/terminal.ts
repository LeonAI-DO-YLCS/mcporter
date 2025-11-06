const forceColorRaw = process.env.FORCE_COLOR?.toLowerCase();
const forceDisableColor = forceColorRaw === '0' || forceColorRaw === 'false';
const forceEnableColor =
  forceColorRaw === '1' || forceColorRaw === 'true' || forceColorRaw === '2' || forceColorRaw === '3';
const hasNoColor = process.env.NO_COLOR !== undefined;
const stdoutStream = process.stdout as NodeJS.WriteStream | undefined;

export const supportsAnsiColor =
  !hasNoColor && (forceEnableColor || (!forceDisableColor && Boolean(stdoutStream?.isTTY)));

// colorize wraps a string in ANSI color codes when output supports them.
export function colorize(code: number, text: string): string {
  if (!supportsAnsiColor) {
    return text;
  }
  return `\u001B[${code}m${text}\u001B[0m`;
}

export const dimText = (text: string): string => colorize(90, text);
export const yellowText = (text: string): string => colorize(33, text);
export const redText = (text: string): string => colorize(31, text);
export const extraDimText = (text: string): string => {
  if (!supportsAnsiColor) {
    return text;
  }
  return `\u001B[38;5;244m${text}\u001B[0m`;
};

const isCI = Boolean(process.env.CI && process.env.CI !== '0' && process.env.CI.toLowerCase() !== 'false');
const spinnerDisabled = process.env.MCPORTER_NO_SPINNER === '1';

export const supportsSpinner = Boolean(stdoutStream?.isTTY && !isCI && !spinnerDisabled);
