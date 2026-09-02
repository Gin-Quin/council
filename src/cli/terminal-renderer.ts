import type { AgentMessageRoute, CouncilEvent } from "../council.ts";

const RESET = "\u001B[0m";
const AGENT_COLORS = [36, 35, 33, 32, 34] as const;

type ActiveMessage = {
  route: AgentMessageRoute;
  buffer: string;
  emittedLines: number;
};

export type AgentTerminalRendererOptions = {
  writeLine: (line: string) => void;
  color: boolean;
};

export class AgentTerminalRenderer {
  private readonly activeMessages = new Map<string, ActiveMessage>();

  constructor(private readonly options: AgentTerminalRendererOptions) {}

  handle(event: CouncilEvent): void {
    switch (event.type) {
      case "agent_message_start":
        this.start(event.route);
        break;
      case "agent_message_delta":
        this.delta(event.messageId, event.delta);
        break;
      case "agent_message_end":
        this.end(event.messageId);
        break;
      default:
        break;
    }
  }

  private start(route: AgentMessageRoute): void {
    this.activeMessages.set(route.messageId, { route, buffer: "", emittedLines: 0 });
    const stage = route.stage.replaceAll("_", " ");
    const round = route.round === undefined ? "" : ` · round ${route.round}`;
    this.options.writeLine(
      `${this.border(route)} ${this.agentName(route)} → ${route.recipient} · ${stage}${round}`,
    );
  }

  private delta(messageId: string, delta: string): void {
    const active = this.activeMessages.get(messageId);
    if (active === undefined) return;
    active.buffer += delta.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

    let newline = active.buffer.indexOf("\n");
    while (newline >= 0) {
      this.emitContentLine(active, active.buffer.slice(0, newline));
      active.buffer = active.buffer.slice(newline + 1);
      newline = active.buffer.indexOf("\n");
    }
  }

  private end(messageId: string): void {
    const active = this.activeMessages.get(messageId);
    if (active === undefined) return;
    if (active.buffer.length > 0) this.emitContentLine(active, active.buffer);
    if (active.emittedLines === 0) this.emitContentLine(active, "[no visible text]");
    this.activeMessages.delete(messageId);
  }

  private emitContentLine(active: ActiveMessage, content: string): void {
    this.options.writeLine(`${this.border(active.route)} ${content}`);
    active.emittedLines += 1;
  }

  private border(route: AgentMessageRoute): string {
    if (!this.options.color) return "│";
    return `\u001B[${this.colorCode(route)}m│${RESET}`;
  }

  private agentName(route: AgentMessageRoute): string {
    if (!this.options.color) return route.displayName;
    return `\u001B[1;${this.colorCode(route)}m${route.displayName}${RESET}`;
  }

  private colorCode(route: AgentMessageRoute): number {
    return AGENT_COLORS[route.participantIndex % AGENT_COLORS.length]!;
  }
}
