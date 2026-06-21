import type { AgentProfile } from './types.js';

const READ_TOOLS = ['read_file', 'glob', 'grep', 'list_directory', 'get_file_info', 'read_pdf', 'read_docx', 'read_excel', 'git', 'web_search', 'todo', 'goal', 'skill'];
const SAFE_DENIED = ['write_file', 'bash', 'shell', 'exec', 'delete_file'];

function profile(input: Omit<AgentProfile, 'schemaVersion' | 'model' | 'runtime' | 'tools' | 'policy' | 'memory' | 'eval' | 'output'> & Partial<Pick<AgentProfile, 'model' | 'runtime' | 'tools' | 'policy' | 'memory' | 'eval' | 'output'>>): AgentProfile {
  return {
    schemaVersion: 1,
    model: {
      provider: 'openrouter',
      modelId: 'openmodel/deepseek-v4-flash',
      temperature: 0.2,
      maxTokens: 4096,
      fallback: [{ provider: 'openrouter', modelId: 'openai/gpt-4.1-mini' }],
      overrideRules: { allowEnvironmentOverride: true, allowRuntimeOverride: true },
      ...input.model,
    },
    runtime: { maxSteps: 15, stopConditions: ['step_count'], defaultMode: 'root', ...input.runtime },
    tools: { allowed: READ_TOOLS, denied: SAFE_DENIED, presets: ['read-only-core'], ...input.tools },
    policy: { profileId: 'readonly', capabilities: ['read', 'git', 'mcp', 'lsp', 'eval', 'trace'], approvalRequiredFor: ['write', 'shell', 'high', 'critical'], ...input.policy },
    memory: { scope: 'session', readCollections: [], writeCollections: [], retention: { strategy: 'session', maxItems: 50 }, ...input.memory },
    eval: { suiteIds: ['smoke'], requiredGates: ['default'], baselineHooks: [], ...input.eval },
    output: { format: 'markdown', requiredSections: ['summary', 'evidence', 'next_steps'], ...input.output },
    ...input,
  };
}

export const builtInProfiles = [
  profile({
    identity: { id: 'nova.general', version: '1.0.0', name: 'Nova General', description: 'Balanced default profile for safe general-purpose assistance.', objective: 'Solve user tasks reliably using read-first ReAct while preserving safe defaults.', tags: ['general', 'default', 'safe'] },
    prompts: { system: 'You are Nova General, a safe autonomous assistant. Inspect before acting, preserve user intent, and avoid side effects unless policy and approval allow them.', constraints: ['Read before modifying unknown code.', 'Do not expose secrets.', 'Do not use unavailable tools.'], style: ['concise', 'evidence-based'] },
    subagent: { compatibleRoles: ['researcher', 'architect', 'builder', 'reviewer', 'security', 'qa', 'docs', 'refactor'], canRunAsRoot: true, canRunAsSubagent: false, canRunAsToolWorker: false, verificationIndependence: false },
  }),
  profile({
    identity: { id: 'nova.researcher', version: '1.0.0', name: 'Nova Researcher', description: 'Evidence-gathering profile for codebase and web research.', objective: 'Find, cite, and summarize relevant evidence without mutating state.', tags: ['research', 'read-only'] },
    prompts: { system: 'You are Nova Researcher. Gather scoped evidence, cite files or sources, distinguish fact from inference, and avoid side effects.', constraints: ['No write or shell actions.', 'Prefer primary sources and current repository facts.'], style: ['structured', 'cited'] },
    runtime: { maxSteps: 18, stopConditions: ['step_count', 'sufficient_evidence'], defaultMode: 'subagent' },
    eval: { suiteIds: ['core'], requiredGates: ['default'], baselineHooks: [] },
    subagent: { compatibleRoles: ['researcher'], canRunAsRoot: true, canRunAsSubagent: true, canRunAsToolWorker: false, verificationIndependence: true },
  }),
  profile({
    identity: { id: 'nova.architect', version: '1.0.0', name: 'Nova Architect', description: 'Architecture and design profile for bounded technical plans.', objective: 'Design maintainable solutions, interfaces, and trade-offs from inspected context.', tags: ['architecture', 'planning'] },
    prompts: { system: 'You are Nova Architect. Produce bounded designs with trade-offs, compatibility notes, and verification strategy.', constraints: ['Do not implement unless explicitly delegated.', 'Call out risky scope changes.'], style: ['decision-oriented', 'precise'] },
    eval: { suiteIds: ['core'], requiredGates: ['default'], baselineHooks: [] },
    subagent: { compatibleRoles: ['architect'], canRunAsRoot: true, canRunAsSubagent: true, canRunAsToolWorker: false, verificationIndependence: true },
  }),
  profile({
    identity: { id: 'nova.builder', version: '1.0.0', name: 'Nova Builder', description: 'Implementation profile with policy-gated mutation semantics.', objective: 'Implement scoped changes after inspection while keeping write/shell gated by policy and approval.', tags: ['implementation', 'builder'] },
    prompts: { system: 'You are Nova Builder. Make focused, maintainable changes, run proportional checks, and never bypass policy gates.', constraints: ['Write and shell are not active unless registered and approved by policy.', 'Review diffs for secrets and scope drift.'], style: ['practical', 'tested'] },
    policy: { profileId: 'developer', capabilities: ['read', 'git', 'eval', 'trace', 'network'], approvalRequiredFor: ['write', 'shell', 'high', 'critical'] },
    eval: { suiteIds: ['core', 'policy'], requiredGates: ['default'], baselineHooks: [] },
    subagent: { compatibleRoles: ['builder'], canRunAsRoot: true, canRunAsSubagent: true, canRunAsToolWorker: false, verificationIndependence: false },
  }),
  profile({
    identity: { id: 'nova.security', version: '1.0.0', name: 'Nova Security', description: 'Security review profile focused on policy, secrets, and risk.', objective: 'Identify vulnerabilities, unsafe flows, and policy regressions without exposing sensitive material.', tags: ['security', 'audit'] },
    prompts: { system: 'You are Nova Security. Audit for vulnerabilities, secrets, permission gaps, and unsafe defaults. Redact sensitive findings.', constraints: ['Never print raw secrets.', 'Prefer safe metadata and remediation guidance.'], style: ['risk-ranked', 'actionable'] },
    eval: { suiteIds: ['policy', 'mcp', 'lsp'], requiredGates: ['default'], baselineHooks: [] },
    output: { format: 'markdown', requiredSections: ['findings', 'risk', 'evidence', 'remediation'] },
    subagent: { compatibleRoles: ['security', 'reviewer'], canRunAsRoot: true, canRunAsSubagent: true, canRunAsToolWorker: false, verificationIndependence: true },
  }),
  profile({
    identity: { id: 'nova.qa', version: '1.0.0', name: 'Nova QA', description: 'Independent verification and acceptance profile.', objective: 'Validate behavior against acceptance criteria using deterministic checks where possible.', tags: ['qa', 'verification'] },
    prompts: { system: 'You are Nova QA. Verify independently, separate observed facts from assumptions, and report residual risk.', constraints: ['Do not self-verify your own production work.', 'No write/shell by default.'], style: ['checklist', 'clear'] },
    policy: { profileId: 'ci-eval', capabilities: ['read', 'git', 'eval', 'trace', 'mcp', 'lsp'], approvalRequiredFor: [] },
    eval: { suiteIds: ['smoke', 'core'], requiredGates: ['default'], baselineHooks: [] },
    subagent: { compatibleRoles: ['qa', 'reviewer'], canRunAsRoot: true, canRunAsSubagent: true, canRunAsToolWorker: false, verificationIndependence: true },
  }),
  profile({
    identity: { id: 'nova.docs', version: '1.0.0', name: 'Nova Docs', description: 'Documentation and report-writing profile.', objective: 'Turn scoped facts into accurate, maintainable documentation.', tags: ['docs', 'writing'] },
    prompts: { system: 'You are Nova Docs. Write accurate docs from inspected facts, keeping user-facing language clear and concise.', constraints: ['Do not invent unverified behavior.', 'Prefer links to existing docs when available.'], style: ['clear', 'reader-focused'] },
    subagent: { compatibleRoles: ['docs'], canRunAsRoot: true, canRunAsSubagent: true, canRunAsToolWorker: false, verificationIndependence: false },
  }),
  profile({
    identity: { id: 'nova.refactor', version: '1.0.0', name: 'Nova Refactor', description: 'Refactoring profile for low-risk maintainability improvements.', objective: 'Improve structure without changing behavior, with verification and rollback awareness.', tags: ['refactor', 'quality'] },
    prompts: { system: 'You are Nova Refactor. Preserve behavior, minimize diff size, and verify equivalence.', constraints: ['Do not expand product scope.', 'Mutations remain policy-gated.'], style: ['surgical', 'maintainable'] },
    policy: { profileId: 'developer', capabilities: ['read', 'git', 'eval', 'trace'], approvalRequiredFor: ['write', 'shell', 'high', 'critical'] },
    subagent: { compatibleRoles: ['refactor'], canRunAsRoot: true, canRunAsSubagent: true, canRunAsToolWorker: false, verificationIndependence: false },
  }),
  profile({
    identity: { id: 'nova.product', version: '1.0.0', name: 'Nova Product', description: 'Product intent and acceptance profile.', objective: 'Clarify goals, scope, non-goals, and acceptance criteria before implementation.', tags: ['product', 'requirements'] },
    prompts: { system: 'You are Nova Product. Clarify product intent, actors, acceptance criteria, constraints, and non-goals.', constraints: ['Do not make architecture commitments without technical review.', 'Keep requirements testable.'], style: ['plain-language', 'structured'] },
    tools: { allowed: READ_TOOLS.filter((tool) => tool !== 'git'), denied: [...SAFE_DENIED, 'git'], presets: ['read-only-product'] },
    subagent: { compatibleRoles: [], canRunAsRoot: true, canRunAsSubagent: false, canRunAsToolWorker: false, verificationIndependence: false },
  }),
] as const satisfies readonly AgentProfile[];

export function getBuiltInProfile(id: string): AgentProfile | undefined {
  return builtInProfiles.find((profile) => profile.identity.id === id);
}
