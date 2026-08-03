export interface DemoReplyButton {
  id: string;
  title: string;
}

export interface DemoListRow {
  id: string;
  title: string;
  description?: string;
}

export interface DemoListSelector {
  title: string;
  buttonText: string;
  rows: DemoListRow[];
}

export interface DemoMessage {
  id: string;
  sender_kind: "user" | "ai" | "system";
  content: string;
  typingDuration?: number;
  delayAfter?: number;
  deliveryStatus?: "sent" | "delivered" | "read";
  replyButtons?: DemoReplyButton[];
  listSelector?: DemoListSelector;
  cartItems?: Array<{
    name: string;
    qty: number;
    size?: string;
    price: number;
    addons?: string[];
  }>;
  workflowStep?: string;
  orderType?: "delivery" | "pickup" | "dine-in";
  address?: string;
  triggerOrderSync?: boolean;
}

export interface DemoScenario {
  id: string;
  name: string;
  customerName: string;
  customerPhone: string;
  branchSlug: string;
  initialCart: Array<{ name: string; qty: number; price: number; size?: string; addons?: string[] }>;
  initialWorkflowStep: string;
  messages: DemoMessage[];
  finalOrder: {
    orderNumber: number;
    type: "delivery";
    customerName: string;
    phone: string;
    address: string;
    items: Array<{ name: string; qty: number; price: number; size?: string; addons?: string[] }>;
    subtotal: number;
    deliveryFee: number;
    total: number;
  };
}

export const RESTAURANT_ORDER_SCENARIO: DemoScenario = {
  id: "fastfood-order-flow",
  name: "Burger Hub Fast Food Order",
  customerName: "Ahmed Khan",
  customerPhone: "+923331234567",
  branchSlug: "burger-hub-dha",
  initialCart: [],
  initialWorkflowStep: "idle",
  messages: [
    {
      id: "msg-1",
      sender_kind: "user",
      content: "Assalam-o-Alaikum! 1 Zinger Burger meal delivery hojaye gi?",
      typingDuration: 0,
      delayAfter: 1000,
      deliveryStatus: "read",
      workflowStep: "awaiting_order_type",
      orderType: "delivery",
    },
    {
      id: "msg-2",
      sender_kind: "ai",
      content: "Walaikum Assalam Ahmed! 🍔 Sure, delivery available hai. Order start karne ke liye option select karein:",
      typingDuration: 1200,
      delayAfter: 1500,
      deliveryStatus: "delivered",
      replyButtons: [
        { id: "delivery", title: "🚚 Delivery" },
        { id: "pickup", title: "🏠 Pickup" },
        { id: "dine_in", title: "🍽️ Dine-In" },
      ],
      workflowStep: "awaiting_delivery_address",
    },
    {
      id: "msg-3",
      sender_kind: "user",
      content: "🚚 Delivery",
      typingDuration: 0,
      delayAfter: 1000,
      deliveryStatus: "read",
      workflowStep: "awaiting_delivery_address",
    },
    {
      id: "msg-4",
      sender_kind: "ai",
      content: "Got it! Please share your complete delivery address & landmark:",
      typingDuration: 1100,
      delayAfter: 1400,
      deliveryStatus: "delivered",
      workflowStep: "awaiting_delivery_address",
    },
    {
      id: "msg-5",
      sender_kind: "user",
      content: "House #15, Street 4, DHA Phase 5, Lahore",
      typingDuration: 0,
      delayAfter: 1000,
      deliveryStatus: "read",
      workflowStep: "collecting_items",
      address: "House #15, Street 4, DHA Phase 5, Lahore",
    },
    {
      id: "msg-6",
      sender_kind: "ai",
      content: "Address saved! 📍 We deliver to DHA Phase 5. Menu se popular item choose karein:",
      typingDuration: 1400,
      delayAfter: 1500,
      deliveryStatus: "delivered",
      listSelector: {
        title: "Fast Food Menu Options",
        buttonText: "📋 View Menu Options",
        rows: [
          { id: "item-1", title: "Smash Zinger Combo", description: "Rs. 890 — Crispy Zinger + Fries + Soft Drink" },
          { id: "item-2", title: "Loaded Cheese Fries", description: "Rs. 490 — Melted Cheese, Jalapeños & Sauce" },
          { id: "item-3", title: "Classic Beef Burger", description: "Rs. 750 — Double Beef Patty & Cheddar" },
          { id: "item-4", title: "Club Sandwich Meal", description: "Rs. 650 — Triple Layered Sandwich & Fries" },
        ],
      },
      workflowStep: "collecting_items",
    },
    {
      id: "msg-7",
      sender_kind: "user",
      content: "1 Smash Zinger Combo aur 1 Loaded Cheese Fries kar dein.",
      typingDuration: 0,
      delayAfter: 1000,
      deliveryStatus: "read",
      cartItems: [
        { name: "Smash Zinger Combo", qty: 1, size: "Combo", price: 890 },
        { name: "Loaded Cheese Fries", qty: 1, price: 490 },
      ],
      workflowStep: "awaiting_confirmation",
    },
    {
      id: "msg-8",
      sender_kind: "ai",
      content: "Awesome choice! 🛍️ Here is your Order Summary:\n\n📋 ITEMS:\n• 1x Smash Zinger Combo — Rs. 890\n• 1x Loaded Cheese Fries — Rs. 490\n-----------------------------------\nSubtotal: Rs. 1,380\nDelivery Fee: Rs. 150\nTotal Amount: Rs. 1,530\n\n📍 DELIVERY ADDRESS:\nHouse #15, Street 4, DHA Phase 5, Lahore\n\nWould you like to confirm this order?",
      typingDuration: 1800,
      delayAfter: 1500,
      deliveryStatus: "delivered",
      replyButtons: [
        { id: "confirm", title: "✅ Confirm Order" },
        { id: "edit", title: "✏️ Edit Cart" },
      ],
      workflowStep: "awaiting_confirmation",
    },
    {
      id: "msg-9",
      sender_kind: "user",
      content: "✅ Confirm Order",
      typingDuration: 0,
      delayAfter: 1000,
      deliveryStatus: "read",
      workflowStep: "completed",
      triggerOrderSync: true,
    },
    {
      id: "msg-10",
      sender_kind: "ai",
      content: "🎉 Thanks Ahmed! Order #1042 confirm ho gaya hai!\n\n💰 Total: Rs. 1,530 (Cash on Delivery)\n⏱️ ETA: 25 - 35 Minutes\n\nKitchen is preparing your fresh order now. Live status dashboard par track kar saktay hain!",
      typingDuration: 1600,
      delayAfter: 1000,
      deliveryStatus: "delivered",
      workflowStep: "completed",
    },
  ],
  finalOrder: {
    orderNumber: 1042,
    type: "delivery",
    customerName: "Ahmed Khan",
    phone: "+923331234567",
    address: "House #15, Street 4, DHA Phase 5, Lahore",
    items: [
      { name: "Smash Zinger Combo", qty: 1, price: 890, size: "Combo" },
      { name: "Loaded Cheese Fries", qty: 1, price: 490 },
    ],
    subtotal: 1380,
    deliveryFee: 150,
    total: 1530,
  },
};
