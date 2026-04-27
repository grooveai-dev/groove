// FSL-1.1-Apache-2.0 — see LICENSE

const APPLY_PATCH_RE = /apply_patch/;
const BEGIN_PATCH_RE = /^\*{3}\s*Begin Patch\s*$/;
const END_PATCH_RE = /^\*{3}\s*End Patch\s*$/;
const ADD_FILE_RE = /^\*{3}\s*Add File:\s*(.+)$/;
const UPDATE_FILE_RE = /^\*{3}\s*Update File:\s*(.+)$/;
const DELETE_FILE_RE = /^\*{3}\s*Delete File:\s*(.+)$/;
const HUNK_HEADER_RE = /^@@@.*@@@/;

export class EditNormalizer {
  detectApplyPatch(actionContent) {
    const text = extractText(actionContent);
    if (!text) return false;
    return APPLY_PATCH_RE.test(text);
  }

  normalize(actionContent, timestamp, startStep) {
    const text = extractText(actionContent);
    if (!text) return [];

    const patchBody = extractPatchBody(text);
    if (!patchBody) return [];

    const sections = parseSections(patchBody);
    const edits = [];
    let step = startStep || 1;

    for (const section of sections) {
      if (section.type === 'add') {
        edits.push({
          step: step++,
          type: 'edit',
          timestamp: timestamp || Date.now() / 1000,
          file_path: section.filePath,
          edit_type: 'create',
          content: section.content,
          old_string: null,
          new_string: null,
          token_count: estimateTokens(section.content),
        });
      } else if (section.type === 'update') {
        const hunks = parseHunks(section.lines);
        for (const hunk of hunks) {
          edits.push({
            step: step++,
            type: 'edit',
            timestamp: timestamp || Date.now() / 1000,
            file_path: section.filePath,
            edit_type: 'modify',
            content: null,
            old_string: hunk.oldString,
            new_string: hunk.newString,
            token_count: estimateTokens(hunk.oldString + hunk.newString),
          });
        }
      } else if (section.type === 'delete') {
        edits.push({
          step: step++,
          type: 'edit',
          timestamp: timestamp || Date.now() / 1000,
          file_path: section.filePath,
          edit_type: 'delete',
          content: null,
          old_string: section.content || null,
          new_string: null,
          token_count: estimateTokens(section.content || ''),
        });
      }
    }

    return edits;
  }
}

function extractText(actionContent) {
  if (typeof actionContent === 'string') return actionContent;
  if (actionContent?.arguments?.command) return actionContent.arguments.command;
  if (actionContent?.content) return actionContent.content;
  return null;
}

function extractPatchBody(text) {
  const lines = text.split('\n');
  let startIdx = -1;
  let endIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (BEGIN_PATCH_RE.test(lines[i].trim())) {
      startIdx = i + 1;
    }
    if (END_PATCH_RE.test(lines[i].trim())) {
      endIdx = i;
    }
  }

  if (startIdx === -1) return null;
  if (endIdx === -1) endIdx = lines.length;

  return lines.slice(startIdx, endIdx).join('\n');
}

function parseSections(body) {
  const lines = body.split('\n');
  const sections = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    let match;
    if ((match = ADD_FILE_RE.exec(trimmed))) {
      if (current) sections.push(current);
      current = { type: 'add', filePath: match[1].trim(), lines: [], content: '' };
    } else if ((match = UPDATE_FILE_RE.exec(trimmed))) {
      if (current) sections.push(current);
      current = { type: 'update', filePath: match[1].trim(), lines: [] };
    } else if ((match = DELETE_FILE_RE.exec(trimmed))) {
      if (current) sections.push(current);
      current = { type: 'delete', filePath: match[1].trim(), lines: [], content: '' };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) sections.push(current);

  for (const section of sections) {
    if (section.type === 'add' || section.type === 'delete') {
      section.content = section.lines.join('\n').trim();
    }
  }

  return sections;
}

function parseHunks(lines) {
  const hunks = [];
  let inHunk = false;
  let oldLines = [];
  let newLines = [];

  for (const line of lines) {
    if (HUNK_HEADER_RE.test(line.trim())) {
      if (inHunk && (oldLines.length > 0 || newLines.length > 0)) {
        hunks.push(buildHunk(oldLines, newLines));
      }
      inHunk = true;
      oldLines = [];
      newLines = [];
      continue;
    }

    if (!inHunk && (line.startsWith('-') || line.startsWith('+') || line.startsWith(' '))) {
      inHunk = true;
    }

    if (!inHunk) continue;

    if (line.startsWith('-')) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      newLines.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
  }

  if (inHunk && (oldLines.length > 0 || newLines.length > 0)) {
    hunks.push(buildHunk(oldLines, newLines));
  }

  return hunks;
}

function buildHunk(oldLines, newLines) {
  return {
    oldString: oldLines.join('\n'),
    newString: newLines.join('\n'),
  };
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
