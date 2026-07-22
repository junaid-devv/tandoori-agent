import { RESTAURANT_ORDER_SCENARIO, DemoScenario, DemoMessage } from "../scenarios/restaurant-order.scenario";

export type DemoControllerState = {
  scenario: DemoScenario;
  stepIndex: number;
  isTyping: boolean;
  activeMessages: DemoMessage[];
  cart: Array<{ name: string; qty: number; price: number; size?: string; addons?: string[] }>;
  workflowStep: string;
  orderType: string | null;
  address: string | null;
  isCompleted: boolean;
};

export class DemoController {
  private state: DemoControllerState;
  private listeners: Set<() => void> = new Set();

  constructor(scenario: DemoScenario = RESTAURANT_ORDER_SCENARIO) {
    this.state = this.createInitialState(scenario);
  }

  private createInitialState(scenario: DemoScenario): DemoControllerState {
    return {
      scenario,
      stepIndex: 0,
      isTyping: false,
      activeMessages: [],
      cart: [...scenario.initialCart],
      workflowStep: scenario.initialWorkflowStep,
      orderType: null,
      address: null,
      isCompleted: false,
    };
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  public getState(): DemoControllerState {
    return this.state;
  }

  public resetScenario() {
    this.state = this.createInitialState(this.state.scenario);
    this.notify();
  }

  public setTyping(isTyping: boolean) {
    this.state = { ...this.state, isTyping };
    this.notify();
  }

  public async showNextMessage(): Promise<DemoMessage | null> {
    const { scenario, stepIndex } = this.state;
    if (stepIndex >= scenario.messages.length) {
      return null;
    }

    const nextMsg = scenario.messages[stepIndex];

    // If AI message and has typing duration, set typing briefly
    if (nextMsg.sender_kind === "ai" && nextMsg.typingDuration && nextMsg.typingDuration > 0) {
      this.setTyping(true);
      await new Promise((r) => setTimeout(r, Math.min(nextMsg.typingDuration || 1000, 800)));
      this.setTyping(false);
    }

    const newMessages = [...this.state.activeMessages, nextMsg];
    let newCart = [...this.state.cart];
    if (nextMsg.cartItems) {
      newCart = nextMsg.cartItems;
    }

    let newWorkflowStep = this.state.workflowStep;
    if (nextMsg.workflowStep) {
      newWorkflowStep = nextMsg.workflowStep;
    }

    let newOrderType = this.state.orderType;
    if (nextMsg.orderType) {
      newOrderType = nextMsg.orderType;
    }

    let newAddress = this.state.address;
    if (nextMsg.address) {
      newAddress = nextMsg.address;
    }

    this.state = {
      ...this.state,
      stepIndex: stepIndex + 1,
      activeMessages: newMessages,
      cart: newCart,
      workflowStep: newWorkflowStep,
      orderType: newOrderType,
      address: newAddress,
      isCompleted: stepIndex + 1 >= scenario.messages.length,
    };

    if (nextMsg.triggerOrderSync) {
      await this.syncDemoOrder();
    }

    this.notify();
    return nextMsg;
  }

  public async playAllSteps(stepDelayMs: number = 800) {
    while (this.state.stepIndex < this.state.scenario.messages.length) {
      await this.showNextMessage();
      await new Promise((r) => setTimeout(r, stepDelayMs));
    }
  }

  public async syncDemoOrder() {
    try {
      await fetch("/api/demo/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      console.error("[DemoController] Order sync error:", e);
    }
  }
}

declare global {
  interface Window {
    __DEMO_CONTROLLER__?: DemoController;
  }
}
