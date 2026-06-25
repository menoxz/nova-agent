import { render, testRender, useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid';
import { createSignal, For, Show } from 'solid-js';
import { createCliRenderer, MacOSScrollAccel, MouseButton, RGBA, TextAttributes, type CliRenderer, type CliRendererConfig, type MouseEvent } from '@opentui/core';

import type { InteractiveTuiContext, TuiDashboardSnapshot, TuiPanelState, TuiRouteId } from './interactive.js';
import { buildTuiDashboardSnapshot } from './interactive.js';
import { redactString } from '../policy/redact.js';

export interface OpenTuiRunOptions {
  verticalSlice?: boolean;
  testMode?: boolean;
}

export interface OpenTuiTestResult {
  frame: string;
  mouseFrame: string;
  keyboardFrame: string;
  mouseActivated: boolean;
  keyboardActivated: boolean;
  hasPromptInput: boolean;
}

const theme = {
  bg: RGBA.fromInts(7, 10, 18),
  panel: RGBA.fromInts(16, 24, 39),
  panelAlt: RGBA.fromInts(24, 35, 56),
  accent: RGBA.fromInts(34, 211, 238),
  accentSoft: RGBA.fromInts(8, 145, 178),
  text: RGBA.fromInts(229, 231, 235),
  muted: RGBA.fromInts(148, 163, 184),
  ok: RGBA.fromInts(34, 197, 94),
  warn: RGBA.fromInts(234, 179, 8),
  danger: RGBA.fromInts(248, 113, 113),
};

export function canRunOpenTuiRuntime(): boolean {
  return process.versions.bun !== undefined;
}

export async function runOpenTui(context: InteractiveTuiContext, options: OpenTuiRunOptions = {}): Promise<void> {
  if (!canRunOpenTuiRuntime()) {
    throw new Error('OpenTUI runtime requires Bun for native terminal FFI in this environment. Use the non-interactive dashboard fallback under Node.');
  }
  const snapshot = await buildTuiDashboardSnapshot(context.config);
  const renderer = await createCliRenderer(openTuiRendererConfig());
  await render(() => <NovaOpenTuiApp snapshot={snapshot} context={context} verticalSlice={options.verticalSlice === true} onExit={() => renderer.destroy()} />, renderer);
}

export async function renderOpenTuiVerticalSliceForTest(snapshot: TuiDashboardSnapshot): Promise<OpenTuiTestResult> {
  const setup = await testRender(() => <NovaOpenTuiApp snapshot={snapshot} verticalSlice testMode />, { width: 96, height: 28, useMouse: true, useKittyKeyboard: {} });
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    await setup.mockMouse.click(5, 7);
    await setup.renderOnce();
    const mouseFrame = setup.captureCharFrame();
    setup.mockInput.pressKey('r');
    await setup.renderOnce();
    const keyboardFrame = setup.captureCharFrame();
    return {
      frame,
      mouseFrame,
      keyboardFrame,
      mouseActivated: mouseFrame.includes('mouse=dashboard'),
      keyboardActivated: keyboardFrame.includes('route=run'),
      hasPromptInput: frame.includes('Prompt input'),
    };
  } finally {
    setup.renderer.destroy();
  }
}

function openTuiRendererConfig(): CliRendererConfig {
  return {
    targetFps: 60,
    gatherStats: false,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    useMouse: true,
    autoFocus: false,
    openConsoleOnError: false,
    externalOutputMode: 'passthrough',
  };
}

function NovaOpenTuiApp(props: { snapshot: TuiDashboardSnapshot; context?: InteractiveTuiContext; verticalSlice?: boolean; testMode?: boolean; onExit?: () => void }) {
  const [route, setRoute] = createSignal<TuiRouteId>('dashboard');
  const [mouse, setMouse] = createSignal('none');
  const [prompt, setPrompt] = createSignal('');
  const [runStatus, setRunStatus] = createSignal('idle');
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const panels = () => props.snapshot.panels;
  const currentPanel = () => panels().find((panel) => panel.id === route()) ?? panels()[0];

  useKeyboard((key) => {
    if (key.eventType === 'release') return;
    const name = key.name.toLowerCase();
    const byHotkey = panels().find((panel) => panel.hotkey === name);
    if (byHotkey) {
      key.preventDefault();
      setRoute(byHotkey.id);
      return;
    }
    if (name === 'escape' || name === 'q') {
      key.preventDefault();
      props.onExit?.();
      renderer.destroy();
    }
  });

  const openPanel = (panel: TuiPanelState, evt?: MouseEvent) => {
    if (evt && evt.button !== MouseButton.LEFT) return;
    evt?.stopPropagation();
    setMouse(panel.id);
    setRoute(panel.id);
  };

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.bg} paddingLeft={1} paddingRight={1} paddingTop={1} flexDirection="column" gap={1}>
      <Header snapshot={props.snapshot} route={route()} mouse={mouse()} />
      <box flexDirection="row" gap={1} flexGrow={1}>
        <Sidebar panels={panels()} route={route()} onOpen={openPanel} />
        <MainPanel panel={currentPanel()} snapshot={props.snapshot} context={props.context} prompt={prompt()} setPrompt={setPrompt} runStatus={runStatus()} setRunStatus={setRunStatus} verticalSlice={props.verticalSlice === true} />
      </box>
      <Footer />
    </box>
  );
}

function Header(props: { snapshot: TuiDashboardSnapshot; route: TuiRouteId; mouse: string }) {
  return (
    <box height={3} backgroundColor={theme.panel} paddingLeft={2} paddingRight={2} flexDirection="row" alignItems="center" justifyContent="space-between">
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>Nova OpenTUI · GUI-grade terminal</text>
      <text fg={theme.muted}>route={props.route} · mouse={props.mouse} · secretsDisplayed={String(props.snapshot.safety.secretsDisplayed)} · rawNovaDisplayed={String(props.snapshot.safety.rawNovaDisplayed)}</text>
    </box>
  );
}

function Sidebar(props: { panels: TuiPanelState[]; route: TuiRouteId; onOpen: (panel: TuiPanelState, event?: MouseEvent) => void }) {
  return (
    <box width={28} backgroundColor={theme.panel} paddingTop={1} paddingLeft={1} paddingRight={1} flexDirection="column" gap={0}>
      <text fg={theme.muted}>Click panels</text>
      <For each={props.panels}>{(panel) => (
        <box
          height={2}
          paddingLeft={1}
          flexDirection="row"
          alignItems="center"
          backgroundColor={props.route === panel.id ? theme.accentSoft : RGBA.fromInts(0, 0, 0, 0)}
          onMouseUp={(event) => props.onOpen(panel, event)}
          onMouseOver={() => undefined}
        >
          <text fg={props.route === panel.id ? theme.text : colorForStatus(panel.status)}>[{panel.hotkey}] {panel.label}</text>
        </box>
      )}</For>
    </box>
  );
}

function MainPanel(props: { panel?: TuiPanelState; snapshot: TuiDashboardSnapshot; context?: InteractiveTuiContext; prompt: string; setPrompt: (value: string) => void; runStatus: string; setRunStatus: (value: string) => void; verticalSlice: boolean }) {
  const panel = () => props.panel;
  return (
    <box flexGrow={1} backgroundColor={theme.panelAlt} paddingTop={1} paddingLeft={2} paddingRight={2} flexDirection="column" gap={1}>
      <Show when={panel()}>{(current) => (
        <>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>{current().label}</text>
            <text fg={colorForStatus(current().status)}>{current().status}</text>
          </box>
          <text fg={theme.muted}>{current().summary}</text>
          <PanelBody panel={current()} snapshot={props.snapshot} />
          <PromptPreview snapshot={props.snapshot} context={props.context} value={props.prompt} setValue={props.setPrompt} runStatus={props.runStatus} setRunStatus={props.setRunStatus} />
        </>
      )}</Show>
    </box>
  );
}

function PanelBody(props: { panel: TuiPanelState; snapshot: TuiDashboardSnapshot }) {
  return (
    <scrollbox height={12} scrollbarOptions={{ visible: true }} scrollAcceleration={new MacOSScrollAccel()}>
      <For each={props.panel.detail}>{(item) => <text fg={theme.text}>• {item}</text>}</For>
      <For each={props.panel.actions}>{(item) => <text fg={theme.accent}>→ {item}</text>}</For>
      <Show when={props.panel.id === 'dashboard'}>
        <text fg={theme.muted}>sessions={props.snapshot.session.sessionCount} runs={props.snapshot.session.runCount} approvals={props.snapshot.session.pendingApprovalCount}/{props.snapshot.session.approvalCount}</text>
        <text fg={theme.muted}>provider={props.snapshot.provider.id} key={props.snapshot.provider.apiKeyStatus} fallback={String(props.snapshot.provider.fallbackEnabled)}</text>
        <text fg={theme.muted}>safety write={props.snapshot.safety.writeToolsDefault} shell={props.snapshot.safety.shellDefault} autonomy={props.snapshot.safety.autonomyDefault}</text>
      </Show>
      <Show when={props.panel.id === 'logs'}>
        <text fg={theme.muted}>latestLogId={props.snapshot.streaming.latestLogId ?? 'none'}</text>
        <text fg={theme.muted}>Use CLI replay for deterministic non-interactive output: nova tui latest | nova tui replay &lt;logId&gt;</text>
      </Show>
      <Show when={props.panel.id === 'approvals'}>
        <text fg={theme.muted}>Approval decisions remain explicit and metadata-only in the TUI.</text>
      </Show>
    </scrollbox>
  );
}

function PromptPreview(props: { snapshot: TuiDashboardSnapshot; context?: InteractiveTuiContext; value: string; setValue: (value: string) => void; runStatus: string; setRunStatus: (value: string) => void }) {
  let running = false;
  const submit = async () => {
    const prompt = props.value.trim();
    if (!prompt || running) return;
    if (!props.context) {
      props.setRunStatus('preview only: no runtime context in smoke/test mode');
      return;
    }
    if (!props.context.config.llm.apiKey) {
      props.setRunStatus('blocked: LLM_API_KEY missing in environment');
      return;
    }
    running = true;
    props.setRunStatus('running: streaming via Nova runtime');
    try {
      const summary = await props.context.runPrompt(prompt, { eventLog: true });
      props.setRunStatus(`done: ${summary?.status ?? 'unknown'} session=${summary?.sessionId ?? 'none'} run=${summary?.runId ?? 'none'}`);
      props.setValue('');
    } catch (err) {
      props.setRunStatus(`error: ${redactString(err instanceof Error ? err.message : String(err), 160)}`);
    } finally {
      running = false;
    }
  };
  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.muted}>Prompt input · focus/click supported · live call remains explicit and requires env key</text>
      <input
        placeholder={props.snapshot.provider.apiKeyStatus === 'present' ? 'Type a prompt; submit flow stays explicit' : 'LLM_API_KEY missing; live prompt blocked'}
        value={props.value}
        onInput={props.setValue}
        onSubmit={submit}
        focusedBackgroundColor={theme.bg}
        cursorColor={theme.accent}
        onMouseDown={(event) => event.target?.focus()}
      />
      <box flexDirection="row" gap={1}>
        <box paddingLeft={2} paddingRight={2} backgroundColor={theme.accentSoft} onMouseUp={() => void submit()}>
          <text fg={theme.text}>Run</text>
        </box>
        <text fg={theme.muted}>{props.runStatus}</text>
      </box>
    </box>
  );
}

function Footer() {
  return (
    <box height={2} backgroundColor={theme.panel} paddingLeft={2} alignItems="center">
      <text fg={theme.muted}>Hotkeys: d dashboard · r prompt · s sessions · c config · p providers · a profiles · l logs · g diagnostics · v approvals · q quit</text>
    </box>
  );
}

function colorForStatus(status: TuiPanelState['status']) {
  if (status === 'ready') return theme.ok;
  if (status === 'warning') return theme.warn;
  if (status === 'blocked') return theme.danger;
  return theme.muted;
}
