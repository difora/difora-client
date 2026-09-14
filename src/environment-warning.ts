const fieldLabels: Record<string, string> = {
  'browser.name': 'Browser',
  'browser.version': 'Browser version',
  'os.name': 'Operating system',
  'os.version': 'OS version',
  deviceScaleFactor: 'Device scale factor',
  locale: 'Locale',
  timezone: 'Time zone',
  'environment.id': 'Environment',
  'environment.revision': 'Environment revision',
  platform: 'Platform',
  'renderer.name': 'Renderer',
  'renderer.version': 'Renderer version',
  'framework.name': 'Framework',
  'framework.version': 'Framework version',
  'device.model': 'Device model',
  'device.runtime': 'Capture runtime',
  'display.scale': 'Display scale',
  'display.density': 'Pixel density',
  'document.dpi': 'Document DPI',
};

/** Only fixed labels enter terminal output; metadata values never do. Old servers omit this. */
export function environmentWarning(status: {
  environmentDifferent?: unknown;
  environmentFields?: unknown;
}): string | null {
  const count = status.environmentDifferent;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0)
    return null;
  const fields = Array.isArray(status.environmentFields)
    ? status.environmentFields
    : [];
  const labels = Object.keys(fieldLabels)
    .filter((f) => fields.includes(f))
    .map((f) => fieldLabels[f]);
  return `WARNING: Environment differs for ${count} snapshot${count === 1 ? '' : 's'}${labels.length ? ` (${labels.join(', ')})` : ''}. Review the recorded values in Capture details. Comparison and exit status are unchanged.`;
}
