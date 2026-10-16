import React from 'react';

interface CodeEditorProps {
  code: string;
  onChange?: (code: string) => void;
  readOnly?: boolean;
  flaggedLines?: number[];
  language?: 'gcode' | 'javascript' | 'json';
  onLineClick?: (line: number) => void;
  selectedLine?: number | null;
}

export function CodeEditor({ 
  code, 
  onChange, 
  readOnly, 
  flaggedLines = [], 
  language = 'gcode',
  onLineClick,
  selectedLine
}: CodeEditorProps) {
  const lines = code.split('\n');

  const highlightLine = (line: string) => {
    if (language === 'gcode') {
      // Very basic G-code highlighting
      return line
        .replace(/([GMXYZFSTH][0-9.-]+)/g, '<span class="text-secondary font-bold">$1</span>')
        .replace(/(\([^)]*\))/g, '<span class="text-tertiary-container italic">$1</span>')
        .replace(/(N[0-9]+)/g, '<span class="text-primary-container">$1</span>');
    }
    return line;
  };

  return (
    <div className="flex bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden font-mono text-xs shadow-inner min-h-[300px] h-full">
      {/* Line Numbers Gutter */}
      <div className="bg-surface-container-low border-r border-outline-variant/20 py-4 text-right text-tertiary-container/60 select-none flex flex-col">
        {lines.map((_, i) => {
          const lineNum = i + 1;
          const isFlagged = flaggedLines.includes(lineNum);
          const isSelected = selectedLine === lineNum;
          
          return (
            <div 
              key={i} 
              onClick={() => onLineClick?.(lineNum)}
              className={`h-5 px-3 cursor-pointer transition-colors hover:text-on-surface flex items-center justify-end gap-1 ${isSelected ? 'bg-secondary/10 text-secondary font-bold' : ''} ${isFlagged ? 'text-error font-bold' : ''}`}
            >
              {isFlagged && <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse" />}
              <span>{lineNum}</span>
            </div>
          );
        })}
      </div>

      {/* Code Area */}
      <div className="flex-1 relative overflow-auto py-4 scrollbar-thin scrollbar-thumb-surface-container-high">
        {readOnly ? (
          <div className="min-w-max">
            {lines.map((line, i) => {
              const lineNum = i + 1;
              const isFlagged = flaggedLines.includes(lineNum);
              const isSelected = selectedLine === lineNum;
              
              return (
                <div
                  key={i}
                  className={`h-5 px-4 whitespace-pre rounded-sm transition-colors ${isSelected ? 'bg-secondary/5' : ''} ${isFlagged ? 'bg-error-container/10 border-l-2 border-l-error -ml-[2px]' : ''}`}
                  dangerouslySetInnerHTML={{ __html: highlightLine(line) || '&nbsp;' }}
                />
              );
            })}
          </div>
        ) : (
          <textarea
            value={code}
            onChange={(e) => onChange?.(e.target.value)}
            className="absolute inset-0 w-full h-full px-4 bg-transparent text-on-surface resize-none focus:outline-none placeholder:text-tertiary-container whitespace-pre overflow-auto"
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
