/**
 * lib/thermal-printer.ts
 * Thermal receipt printer utility for 58mm and 80mm POS receipt printers.
 * Generates clean, high-contrast, monospace thermal receipt HTML and
 * prints silently via a hidden iframe to the Windows default printer.
 */

export interface ReceiptItem {
  id?: string;
  name: string;
  qty: number;
  price: number;
  size?: string | null;
  addons?: unknown;
  item_instructions?: string | null;
}

export interface ReceiptOrderData {
  id: string;
  order_number: number;
  type: "delivery" | "pickup" | "dine-in";
  status: string;
  subtotal: number;
  delivery_fee: number;
  total?: number;
  customer_instructions?: string | null;
  address?: string | null;
  guests?: number | null;
  reservation_time?: string | null;
  pickup_time?: string | null;
  created_at: string;
  branches?: {
    name?: string | null;
    slug?: string | null;
    phone?: string | null;
    address?: string | null;
  } | null;
  conversations?: {
    phone?: string | null;
    name?: string | null;
  } | null;
  order_items: ReceiptItem[];
}

export interface ReceiptPrintOptions {
  paperWidth?: "58mm" | "80mm";
  restaurantName?: string;
  branchName?: string;
  phone?: string;
  footerMessage?: string;
}

/**
 * Format add-ons into a readable string
 */
function formatAddons(addons: unknown): string[] {
  if (!addons) return [];
  if (Array.isArray(addons)) {
    return addons
      .map((a) => {
        if (typeof a === "string") return a;
        if (typeof a === "object" && a !== null) {
          const item = a as { name?: string; price?: number; label?: string };
          const label = item.name || item.label || "";
          const price = item.price ? ` (+Rs. ${item.price})` : "";
          return `${label}${price}`.trim();
        }
        return String(a);
      })
      .filter(Boolean);
  }
  if (typeof addons === "object" && addons !== null) {
    return Object.entries(addons as Record<string, unknown>).map(
      ([key, val]) => `${key}: ${String(val)}`
    );
  }
  return [];
}

/**
 * Generate printable thermal receipt HTML string
 */
export function generateReceiptHtml(
  order: ReceiptOrderData,
  options: ReceiptPrintOptions = {}
): string {
  const paperWidth = options.paperWidth || "80mm";
  const restaurantName = options.restaurantName || "ORDERiQ RESTAURANT";
  const branchName = order.branches?.name || options.branchName || "Main Branch";
  const branchPhone = order.branches?.phone || options.phone || "";
  const footerMessage = options.footerMessage || "Thank you for ordering with us!";

  const subtotal = Number(order.subtotal) || 0;
  const deliveryFee = Number(order.delivery_fee) || 0;
  const total = Number(order.total) || subtotal + deliveryFee;

  const dateObj = new Date(order.created_at);
  const formattedDate = !isNaN(dateObj.getTime())
    ? dateObj.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";
  const formattedTime = !isNaN(dateObj.getTime())
    ? dateObj.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "";

  const customerName = order.conversations?.name || "Guest Customer";
  const customerPhone = order.conversations?.phone || "N/A";
  const typeLabel = (order.type || "DELIVERY").toUpperCase();

  // 58mm is ~48mm printable area (~32 cols font-mono), 80mm is ~72mm printable area (~48 cols)
  const is58mm = paperWidth === "58mm";
  const containerWidth = is58mm ? "48mm" : "72mm";
  const baseFontSize = is58mm ? "11px" : "12px";

  const itemsHtml = (order.order_items || []).map((item) => {
    const itemTotal = Number(item.price || 0) * (Number(item.qty) || 1);
    const addonsList = formatAddons(item.addons);
    const hasDetails = item.size || addonsList.length > 0 || item.item_instructions;

    return `
      <div style="margin-bottom: 5px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; font-weight: bold;">
          <div style="flex: 1; padding-right: 4px;">
            <span>${item.qty}x</span> ${item.name}
          </div>
          <div style="white-space: nowrap; text-align: right;">
            Rs. ${itemTotal.toLocaleString()}
          </div>
        </div>
        ${
          hasDetails
            ? `
          <div style="padding-left: 14px; font-size: 0.9em; color: #333;">
            ${item.size ? `<div>Size: ${item.size}</div>` : ""}
            ${addonsList.map((addon) => `<div>+ ${addon}</div>`).join("")}
            ${item.item_instructions ? `<div style="font-style: italic;">Note: ${item.item_instructions}</div>` : ""}
          </div>
        `
            : ""
        }
      </div>
    `;
  }).join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt #${order.order_number}</title>
  <style>
    @page {
      margin: 0;
      size: ${paperWidth} auto;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      width: ${containerWidth};
      margin: 0 auto;
      padding: 8px 4px 20px 4px;
      font-family: 'Courier New', Courier, monospace, -apple-system, sans-serif;
      font-size: ${baseFontSize};
      line-height: 1.35;
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .divider {
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    .double-divider {
      border-top: 2px solid #000;
      margin: 6px 0;
    }
    .text-center {
      text-align: center;
    }
    .text-right {
      text-align: right;
    }
    .bold {
      font-weight: bold;
    }
    .flex-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 2px;
    }
    .large {
      font-size: 1.35em;
    }
    .extra-large {
      font-size: 1.7em;
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border: 1px solid #000;
      font-weight: bold;
      text-transform: uppercase;
      margin: 4px 0;
    }
    .instructions-box {
      border: 1px solid #000;
      padding: 4px;
      margin: 6px 0;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <!-- Restaurant Header -->
  <div class="text-center">
    <div class="bold large">${restaurantName.toUpperCase()}</div>
    ${branchName ? `<div>${branchName}</div>` : ""}
    ${branchPhone ? `<div>Tel: ${branchPhone}</div>` : ""}
  </div>

  <div class="divider"></div>

  <!-- Order Number & Type -->
  <div class="text-center">
    <div class="bold extra-large">ORDER #${order.order_number}</div>
    <div class="badge">${typeLabel}</div>
    <div style="font-size: 0.9em; margin-top: 2px;">
      ${formattedDate} • ${formattedTime}
    </div>
  </div>

  <div class="divider"></div>

  <!-- Customer Details -->
  <div>
    <div class="flex-row">
      <span class="bold">Customer:</span>
      <span>${customerName}</span>
    </div>
    <div class="flex-row">
      <span class="bold">Phone:</span>
      <span>${customerPhone}</span>
    </div>
    ${
      order.address
        ? `
      <div style="margin-top: 2px;">
        <span class="bold">Address:</span>
        <div>${order.address}</div>
      </div>
    `
        : ""
    }
    ${
      order.type === "dine-in" && order.guests
        ? `
      <div class="flex-row">
        <span class="bold">Guests:</span>
        <span>${order.guests}</span>
      </div>
    `
        : ""
    }
    ${
      order.pickup_time
        ? `
      <div class="flex-row">
        <span class="bold">Pickup Time:</span>
        <span>${order.pickup_time}</span>
      </div>
    `
        : ""
    }
  </div>

  <!-- Customer Special Instructions -->
  ${
    order.customer_instructions
      ? `
    <div class="instructions-box">
      ⚠️ NOTE: ${order.customer_instructions}
    </div>
  `
      : ""
  }

  <div class="double-divider"></div>

  <!-- Items Header -->
  <div class="flex-row bold" style="margin-bottom: 4px; font-size: 0.95em;">
    <span>ITEMS</span>
    <span>AMOUNT</span>
  </div>
  <div class="divider"></div>

  <!-- Items Body -->
  ${itemsHtml}

  <div class="double-divider"></div>

  <!-- Pricing Summary -->
  <div class="flex-row">
    <span>Subtotal:</span>
    <span>Rs. ${subtotal.toLocaleString()}</span>
  </div>
  ${
    deliveryFee > 0
      ? `
    <div class="flex-row">
      <span>Delivery Fee:</span>
      <span>Rs. ${deliveryFee.toLocaleString()}</span>
    </div>
  `
      : ""
  }
  <div class="divider"></div>
  <div class="flex-row bold large" style="margin-top: 4px;">
    <span>TOTAL DUE (COD):</span>
    <span>Rs. ${total.toLocaleString()}</span>
  </div>

  <div class="divider"></div>

  <!-- Footer -->
  <div class="text-center" style="margin-top: 10px; font-size: 0.9em;">
    <div>${footerMessage}</div>
    <div style="margin-top: 4px; font-size: 0.8em; color: #444;">
      *** Kitchen Copy / POS Invoice ***
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Print raw HTML silently to the default printer using a hidden iframe
 */
export function printReceiptHtml(htmlContent: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(false);
      return;
    }

    try {
      let iframe = document.getElementById("thermal-receipt-print-frame") as HTMLIFrameElement | null;
      if (!iframe) {
        iframe = document.createElement("iframe");
        iframe.id = "thermal-receipt-print-frame";
        iframe.style.position = "fixed";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "none";
        iframe.style.opacity = "0";
        iframe.style.pointerEvents = "none";
        document.body.appendChild(iframe);
      }

      const frameDoc = iframe.contentWindow?.document;
      if (!frameDoc) {
        console.error("[ThermalPrinter] Failed to access iframe document");
        resolve(false);
        return;
      }

      frameDoc.open();
      frameDoc.write(htmlContent);
      frameDoc.close();

      // Allow fonts and styles to render before triggering print
      setTimeout(() => {
        try {
          iframe?.contentWindow?.focus();
          iframe?.contentWindow?.print();
          resolve(true);
        } catch (printErr) {
          console.error("[ThermalPrinter] Print call failed:", printErr);
          resolve(false);
        }
      }, 250);
    } catch (err) {
      console.error("[ThermalPrinter] Error initiating print job:", err);
      resolve(false);
    }
  });
}

/**
 * Print an order receipt
 */
export async function printOrderReceipt(
  order: ReceiptOrderData,
  options: ReceiptPrintOptions = {}
): Promise<boolean> {
  const html = generateReceiptHtml(order, options);
  return printReceiptHtml(html);
}

/**
 * Print a test receipt for verifying printer connectivity and formatting
 */
export async function printTestReceipt(
  restaurantName = "ORDERiQ TEST RESTAURANT",
  paperWidth: "58mm" | "80mm" = "80mm"
): Promise<boolean> {
  const sampleOrder: ReceiptOrderData = {
    id: "test-order-sample",
    order_number: 101,
    type: "delivery",
    status: "received",
    subtotal: 1450,
    delivery_fee: 150,
    total: 1600,
    customer_instructions: "Please ring bell and leave at door.",
    address: "House 14, Street 3, Sector F-8/2, Islamabad",
    created_at: new Date().toISOString(),
    branches: {
      name: "Downtown Branch",
      phone: "+92 300 1234567",
      address: "Main Boulevard",
    },
    conversations: {
      name: "Ahmed Khan",
      phone: "+92 300 9876543",
    },
    order_items: [
      {
        id: "item-1",
        name: "Classic Zinger Burger",
        qty: 2,
        price: 550,
        size: "Regular",
        addons: ["Extra Cheese", "Jalapenos"],
        item_instructions: "Extra sauce please",
      },
      {
        id: "item-2",
        name: "Masala Fries (Large)",
        qty: 1,
        price: 350,
      },
    ],
  };

  return printOrderReceipt(sampleOrder, {
    paperWidth,
    restaurantName,
    branchName: "Downtown Branch",
    footerMessage: "Thermal Printer Test Successful!",
  });
}
