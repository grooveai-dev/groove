// FSL-1.1-Apache-2.0 — see LICENSE
//
// Retroactive tagger: scans planner/fullstack session envelopes and re-tags
// delegation dispatches as "delegate" steps and artifact handoffs as "yield" steps.
//
// Usage:
//   node retag-delegate-yield.js <input.jsonl> [output.jsonl]
//
// If output is omitted, writes to stdout. Input can also be piped via stdin.
// Only modifies planner/fullstack trajectory envelopes — SESSION_CLOSE and
// USER_FEEDBACK envelopes pass through unchanged.

import { createReadStream, createWriteStream, existsSync } from 'fs';
import { createInterface } from 'readline';

// --- Pattern A: Delegation detection ---
// A thought step reasoning about needing a specialist, followed by an action
// that dispatches to another agent. The dispatch action+observation get replaced
// with a single delegate step.

const DELEGATION_THOUGHT_RE = /\b(specialist|dispatch|delegate|hand off|route to|needs? a .*(backend|frontend|fullstack|database|devops|planner)|re-route|different agent|another agent|pass this to)\b/i;

const DELEGATION_ACTION_RE = /\b(dispatch|spawn|agent|delegate|hand off|route|assign)\b/i;

const AGENT_ID_RE = /\b(backend|frontend|fullstack|planner|devops|database|chat|advisor|qc)[-_]?\d+\b/gi;

function isDelegationThought(step) {
  if (step.type !== 'thought') return false;
  return DELEGATION_THOUGHT_RE.test(step.content || '');
}

function isDelegationAction(step) {
  if (step.type !== 'action') return false;
  const tool = (step.tool || '').toLowerCase();
  const content = (step.content || '').toLowerCase();
  if (tool === 'agent' || tool === 'dispatch') return true;
  if (DELEGATION_ACTION_RE.test(content)) return true;
  return false;
}

function extractDelegateTask(actionStep, observationStep) {
  let task = '';
  const content = actionStep.content || '';
  const args = actionStep.arguments || {};

  // Try to extract the task from arguments (e.g. Agent tool input)
  if (args.prompt) {
    task = args.prompt;
  } else if (args.message) {
    task = args.message;
  } else if (args.task) {
    task = args.task;
  }

  // Fall back to parsing the content after "Dispatch to X:" or similar
  if (!task) {
    const match = content.match(/(?:dispatch(?:ed)? to \S+:\s*|:\s*)(.*)/i);
    task = match ? match[1] : content;
  }

  // Strip agent ID references — the router picks the target, not the delegator
  task = task.replace(AGENT_ID_RE, '').replace(/\s{2,}/g, ' ').trim();

  return task;
}

// --- Pattern B: Yield detection ---
// An action(Write/Edit) producing a file, followed by observation(success),
// followed by a resolution whose content suggests artifact handoff to another agent.

const WRITE_TOOLS = new Set(['write', 'edit', 'create', 'save']);

const YIELD_RESOLUTION_RE = /\b(next agent|can now|build on this|picks? up|hand(?:ed|s|ing)? off|artifact|ready for|phase complete|my part is done|produced|output for)\b/i;

function isWriteAction(step) {
  if (step.type !== 'action') return false;
  const tool = (step.tool || '').toLowerCase();
  return WRITE_TOOLS.has(tool);
}

function isSuccessObservation(step) {
  if (step.type !== 'observation') return false;
  const c = (step.content || '').toLowerCase();
  if (step.is_error) return false;
  return !c.includes('error') || c.includes('0 error');
}

function isYieldResolution(step) {
  if (step.type !== 'resolution') return false;
  return YIELD_RESOLUTION_RE.test(step.content || '');
}

function extractFilePath(writeStep) {
  const args = writeStep.arguments || {};
  if (args.file_path) return args.file_path;
  if (args.path) return args.path;

  // Try to parse path from content
  const content = writeStep.content || '';
  const match = content.match(/(?:Writing|Wrote|Created?|Saving?|Edit(?:ing|ed)?)\s+(\S+\.\w+)/i);
  return match ? match[1] : null;
}

function buildYieldSummary(resolutionStep, maxTokens = 20) {
  const content = (resolutionStep.content || '').trim();
  // Take first sentence, cap at ~80 chars for ~20 tokens
  const firstSentence = content.split(/[.!?\n]/)[0].trim();
  return firstSentence.slice(0, 80);
}

// --- Main retagging logic ---

function retagTrajectory(steps) {
  if (!Array.isArray(steps) || steps.length < 2) return { steps, delegateCount: 0, yieldCount: 0 };

  const result = [];
  let delegateCount = 0;
  let yieldCount = 0;
  let i = 0;

  while (i < steps.length) {
    // Pattern A: thought(delegation) → action(dispatch) → observation → ...
    // Replace action+observation with a single delegate step
    if (i + 2 < steps.length &&
        isDelegationThought(steps[i]) &&
        isDelegationAction(steps[i + 1])) {

      // Keep the thought
      result.push({ ...steps[i] });

      const actionStep = steps[i + 1];
      const nextStep = steps[i + 2];
      const obsStep = nextStep.type === 'observation' ? nextStep : null;

      const task = extractDelegateTask(actionStep, obsStep);

      if (task) {
        result.push({
          step: actionStep.step,
          type: 'delegate',
          content: task,
          timestamp: actionStep.timestamp,
          token_count: Math.max(1, Math.ceil(task.length / 4)),
        });
        delegateCount++;

        // Skip the action and observation
        i += obsStep ? 3 : 2;

        // If the next step is a resolution that just confirms dispatch, skip it too
        if (i < steps.length && steps[i].type === 'resolution') {
          const rc = (steps[i].content || '').toLowerCase();
          if (rc.includes('dispatch') || rc.includes('delegat') || rc.includes('handed off') || rc.length < 50) {
            i++;
          }
        }
        continue;
      }
    }

    // Pattern B: action(Write/Edit) → observation(success) → resolution(handoff)
    // Replace resolution with yield
    if (i + 2 < steps.length &&
        isWriteAction(steps[i]) &&
        isSuccessObservation(steps[i + 1]) &&
        isYieldResolution(steps[i + 2])) {

      // Keep the action and observation as-is
      result.push({ ...steps[i] });
      result.push({ ...steps[i + 1] });

      const writeStep = steps[i];
      const resStep = steps[i + 2];
      const path = extractFilePath(writeStep);
      const summary = buildYieldSummary(resStep);

      const yieldStep = {
        step: resStep.step,
        type: 'yield',
        content: summary,
        timestamp: resStep.timestamp,
        token_count: Math.max(1, Math.ceil(summary.length / 4)),
      };
      if (path) yieldStep.path = path;

      result.push(yieldStep);
      yieldCount++;
      i += 3;
      continue;
    }

    // No pattern match — pass through unchanged
    result.push({ ...steps[i] });
    i++;
  }

  return { steps: result, delegateCount, yieldCount };
}

// --- Process envelopes ---

async function processStream(input, output) {
  const rl = createInterface({ input, crlfDelay: Infinity });

  let totalEnvelopes = 0;
  let modifiedEnvelopes = 0;
  let totalDelegates = 0;
  let totalYields = 0;
  let skippedRoles = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let envelope;
    try {
      envelope = JSON.parse(trimmed);
    } catch {
      output.write(trimmed + '\n');
      continue;
    }

    totalEnvelopes++;

    // Pass through non-trajectory envelopes unchanged
    if (envelope.type === 'SESSION_CLOSE' || envelope.type === 'USER_FEEDBACK') {
      output.write(JSON.stringify(envelope) + '\n');
      continue;
    }

    // Only retag planner and fullstack sessions (where delegation/yield patterns occur)
    const role = envelope.metadata?.agent_role;
    if (!role || !['planner', 'fullstack', 'advisor'].includes(role)) {
      skippedRoles++;
      output.write(JSON.stringify(envelope) + '\n');
      continue;
    }

    const steps = envelope.trajectory_log;
    if (!Array.isArray(steps) || steps.length < 2) {
      output.write(JSON.stringify(envelope) + '\n');
      continue;
    }

    const { steps: retagged, delegateCount, yieldCount } = retagTrajectory(steps);

    if (delegateCount > 0 || yieldCount > 0) {
      modifiedEnvelopes++;
      totalDelegates += delegateCount;
      totalYields += yieldCount;
      envelope.trajectory_log = retagged;
    }

    output.write(JSON.stringify(envelope) + '\n');
  }

  return { totalEnvelopes, modifiedEnvelopes, totalDelegates, totalYields, skippedRoles };
}

// --- Entry point ---

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  const outputPath = args[1];

  let input;
  if (inputPath && inputPath !== '-') {
    if (!existsSync(inputPath)) {
      console.error(`Error: input file not found: ${inputPath}`);
      process.exit(1);
    }
    input = createReadStream(inputPath, 'utf8');
  } else {
    input = process.stdin;
  }

  let output;
  if (outputPath) {
    output = createWriteStream(outputPath, 'utf8');
  } else {
    output = process.stdout;
  }

  const stats = await processStream(input, output);

  if (output !== process.stdout) {
    output.end();
  }

  // Print stats to stderr so they don't mix with JSONL output
  console.error(`\n--- Retag Summary ---`);
  console.error(`Envelopes processed: ${stats.totalEnvelopes}`);
  console.error(`Envelopes modified:  ${stats.modifiedEnvelopes}`);
  console.error(`Delegate steps added: ${stats.totalDelegates}`);
  console.error(`Yield steps added:    ${stats.totalYields}`);
  console.error(`Skipped (wrong role): ${stats.skippedRoles}`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
