// FSL-1.1-Apache-2.0 — see LICENSE

export function TableTree({ headers, rows }) {
  if (!headers?.length || !rows?.length) return null;
  return (
    <div className="space-y-3 my-2 font-sans">
      {rows.map((row, ri) => {
        const restItems = headers.slice(1).map((h, j) => ({
          label: h,
          value: row[j + 1] ?? '',
        }));
        return (
          <div key={ri}>
            <div className="text-xs font-semibold text-text-0">
              {headers[0]}: {row[0] ?? ''}
            </div>
            <div>
              {restItems.map(({ label, value }, j) => {
                const isLast = j === restItems.length - 1;
                return (
                  <div key={j} className="flex items-baseline gap-1 text-xs leading-5">
                    <span className="text-text-3 font-mono w-3 flex-shrink-0">
                      {isLast ? '└' : '├'}
                    </span>
                    <span className="text-text-1">{label}:</span>
                    <code className="px-1.5 py-0.5 rounded bg-surface-0 text-xs font-mono text-accent">
                      {value}
                    </code>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
