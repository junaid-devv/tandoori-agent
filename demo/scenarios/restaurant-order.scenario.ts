export interface DemoMessage {
  id: string;
  sender_kind: "user" | "ai" | "system";
  content: string;
  typingDuration?: number;
  delayAfter?: number;
  deliveryStatus?: "sent" | "delivered" | "read";
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
  id: "tandoori-order-flow",
  name: "Tandoori Hub Pakistani Feast Order",
  customerName: "Tariq Mahmood",
  customerPhone: "+923001234567",
  branchSlug: "tandoori-islamabad",
  initialCart: [],
  initialWorkflowStep: "idle",
  messages: [
    {
      id: "msg-1",
      sender_kind: "user",
      content: "Assalamu Alaikum! I'd like to place a delivery order for dinner.",
      typingDuration: 0,
      delayAfter: 1200,
      deliveryStatus: "read",
      workflowStep: "awaiting_order_type",
      orderType: "delivery",
    },
    {
      id: "msg-2",
      sender_kind: "ai",
      content: "Walaikum Assalam Tariq sb! 🌿 Welcome to Tandoori Hub. I'd be delighted to take your delivery order!\n\nCould you please share your complete delivery address and nearest landmark?",
      typingDuration: 1400,
      delayAfter: 1500,
      deliveryStatus: "delivered",
      workflowStep: "awaiting_delivery_address",
    },
    {
      id: "msg-3",
      sender_kind: "user",
      content: "House #42, Street 7, Sector F-6/2, Islamabad (near Super Market).",
      typingDuration: 0,
      delayAfter: 1200,
      deliveryStatus: "read",
      workflowStep: "collecting_items",
      address: "House #42, Street 7, Sector F-6/2, Islamabad",
    },
    {
      id: "msg-4",
      sender_kind: "ai",
      content: "Thank you! We deliver to Sector F-6/2! 🚚\n\nWhat delicious items would you like to order today? Our Peshawari Chicken Karahi and Fresh Naans are customer favorites!",
      typingDuration: 1500,
      delayAfter: 1500,
      deliveryStatus: "delivered",
      workflowStep: "collecting_items",
    },
    {
      id: "msg-5",
      sender_kind: "user",
      content: "Please add 1 Full Peshawari Chicken Karahi and 4 Roghani Naans.",
      typingDuration: 0,
      delayAfter: 1200,
      deliveryStatus: "read",
      cartItems: [
        { name: "Peshawari Chicken Karahi", qty: 1, size: "Full", price: 2400 },
        { name: "Roghani Naan", qty: 4, price: 80 },
      ],
      workflowStep: "awaiting_upsell_reply",
    },
    {
      id: "msg-6",
      sender_kind: "ai",
      content: "Our Special Peshawari Chicken Karahi is our top seller! 🍲\n\nI have added:\n• 1x Peshawari Chicken Karahi (Full) - Rs. 2,400\n• 4x Roghani Naan - Rs. 320\n\nWould you like to complement your meal with Mint Raita or Chilled Cokes (1.5L)?",
      typingDuration: 1800,
      delayAfter: 1500,
      deliveryStatus: "delivered",
      workflowStep: "awaiting_upsell_reply",
    },
    {
      id: "msg-7",
      sender_kind: "user",
      content: "Yes, please add 1 Mint Raita and 2 Cokes (1.5L).",
      typingDuration: 0,
      delayAfter: 1200,
      deliveryStatus: "read",
      cartItems: [
        { name: "Peshawari Chicken Karahi", qty: 1, size: "Full", price: 2400 },
        { name: "Roghani Naan", qty: 4, price: 80 },
        { name: "Mint Raita", qty: 1, price: 180 },
        { name: "Coke 1.5L", qty: 2, price: 200 },
      ],
      workflowStep: "awaiting_confirmation",
    },
    {
      id: "msg-8",
      sender_kind: "ai",
      content: "Excellent choices! 🥤 Here is your final Order Summary:\n\n📋 ITEMS:\n• 1x Peshawari Chicken Karahi (Full) — Rs. 2,400\n• 4x Roghani Naan — Rs. 320\n• 1x Mint Raita — Rs. 180\n• 2x Coke 1.5L — Rs. 400\n-----------------------------------\nSubtotal: Rs. 3,300\nDelivery Fee: Rs. 150\nTotal Amount: Rs. 3,450\n\n📍 DELIVERY ADDRESS:\nHouse #42, Street 7, Sector F-6/2, Islamabad\n\nPlease reply 'CONFIRM' to place your order now!",
      typingDuration: 2000,
      delayAfter: 1500,
      deliveryStatus: "delivered",
      workflowStep: "awaiting_confirmation",
    },
    {
      id: "msg-9",
      sender_kind: "user",
      content: "CONFIRM",
      typingDuration: 0,
      delayAfter: 1200,
      deliveryStatus: "read",
      workflowStep: "completed",
      triggerOrderSync: true,
    },
    {
      id: "msg-10",
      sender_kind: "ai",
      content: "🎉 Thank you, Tariq sb! Your order #1042 has been successfully confirmed!\n\n💰 Total: Rs. 3,450 (Cash on Delivery)\n⏱️ Estimated Delivery: 35 - 45 Minutes\n\nOur kitchen has started preparing your fresh Peshawari Karahi. You can track your order status live on our dashboard!",
      typingDuration: 1800,
      delayAfter: 1000,
      deliveryStatus: "delivered",
      workflowStep: "completed",
    },
  ],
  finalOrder: {
    orderNumber: 1042,
    type: "delivery",
    customerName: "Tariq Mahmood",
    phone: "+923001234567",
    address: "House #42, Street 7, Sector F-6/2, Islamabad",
    items: [
      { name: "Peshawari Chicken Karahi", qty: 1, price: 2400, size: "Full" },
      { name: "Roghani Naan", qty: 4, price: 80 },
      { name: "Mint Raita", qty: 1, price: 180 },
      { name: "Coke 1.5L", qty: 2, price: 200 },
    ],
    subtotal: 3300,
    deliveryFee: 150,
    total: 3450,
  },
};
