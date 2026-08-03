import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody, requireTrimmedString } from "@/lib/api-utils";
import { requireApiSession } from "@/lib/branch-request";
import { canAccessOrder } from "@/lib/record-access";
import { sendAndPersistOutboundMessage } from "@/lib/messages";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import { createStaffAlert, resolveStaffAlerts } from "@/lib/staff-alerts";
import { supabaseAdmin } from "@/lib/supabase-admin";

const VALID_STATUSES = [
  "received",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;
const CANCELLATION_WINDOW_MS = 10 * 60 * 1000;

type OrderStatus = (typeof VALID_STATUSES)[number];
type StatusPatchBody = { status?: OrderStatus; assigned_to?: string | null };
type OrderWithConversation = {
  branch_id: string;
  order_number: number;
  status: OrderStatus;
  type: "delivery" | "pickup" | "dine-in";
  created_at: string;
  conversation_id: string;
  assigned_to?: string | null;
  cancellation_requested_at?: string | null;
  cancelled_at?: string | null;
  conversations?: { phone?: string | null; name?: string | null } | null;
};

const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  received: ["preparing", "cancelled"],
  preparing: ["out_for_delivery", "delivered", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

const STATUS_MESSAGES: Record<Exclude<OrderStatus, "received">, string> = {
  preparing: "Your order is being prepared. It will be ready soon.",
  out_for_delivery: "Your order is on the way and should reach you shortly.",
  delivered: "Your order has been delivered. Thank you for choosing {restaurant}.",
  cancelled: "Your order has been cancelled. For help, please call {support_phone}.",
};

function normalizeAssignee(value: string | null | undefined) {
  if (value == null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return requireTrimmedString(normalized, "Assignee", 120);
}

const STATUS_BODY_LIMIT_BYTES = 2 * 1024;

function getNotificationFailureMessage(orderNumber: number, status: OrderStatus, reason: string) {
  return `Customer notification failed for order #${orderNumber} after status changed to ${status.replaceAll("_", " ")}: ${reason}`;
}

async function createDeliveryNotificationAlert(input: {
  conversationId: string;
  branchId: string;
  orderNumber: number;
  status: OrderStatus;
  reason: string;
}) {
  await createStaffAlert({
    conversationId: input.conversationId,
    branchId: input.branchId,
    kind: "delivery_notification",
    severity: "high",
    message: getNotificationFailureMessage(input.orderNumber, input.status, input.reason),
  }).catch((alertError) => {
    console.error("Failed to create delivery notification staff alert", alertError);
  });
}

// PATCH /api/orders/[id]/status
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const accessibleOrder = await canAccessOrder(auth.session, id);
  if (!accessibleOrder) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  let body: StatusPatchBody;
  try {
    body = await readLimitedJsonBody<StatusPatchBody>(req, STATUS_BODY_LIMIT_BYTES);
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Invalid order update request.", context: "order status PATCH" });
  }
  const { status } = body;
  const assignedTo = normalizeAssignee(body.assigned_to);

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  if (status === undefined && body.assigned_to === undefined) {
    return NextResponse.json({ error: "No changes requested" }, { status: 400 });
  }

  const { data: existingOrder, error: existingError } = await supabaseAdmin
    .from("orders")
    .select(`branch_id, order_number, status, type, created_at, conversation_id, assigned_to, cancellation_requested_at, cancelled_at, conversations (phone, name)`)
    .eq("id", accessibleOrder.id)
    .single();

  if (existingError || !existingOrder) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const typedExistingOrder = existingOrder as OrderWithConversation;
  if (status && typedExistingOrder.status !== status && !STATUS_TRANSITIONS[typedExistingOrder.status].includes(status)) {
    return NextResponse.json(
      { error: `Cannot move an order from ${typedExistingOrder.status} to ${status}.` },
      { status: 400 },
    );
  }

  if (status === "cancelled" && typedExistingOrder.status !== "cancelled") {
    const createdAtMs = new Date(typedExistingOrder.created_at).getTime();
    const withinWindow = Number.isFinite(createdAtMs) && Date.now() - createdAtMs <= CANCELLATION_WINDOW_MS;
    if (!withinWindow) {
      return NextResponse.json(
        { error: "Order cancellation window has expired (10 minutes)." },
        { status: 400 },
      );
    }
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (status !== undefined) updates.status = status;
  if (body.assigned_to !== undefined) updates.assigned_to = assignedTo;
  if (status === "cancelled" && typedExistingOrder.status !== "cancelled") {
    updates.cancellation_requested_at = new Date().toISOString();
    updates.cancelled_at = new Date().toISOString();
  }

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .update(updates)
    .eq("id", accessibleOrder.id)
    .select(`*, conversations (phone, name)`)
    .single();

  if (error || !order) {
    return apiErrorResponse(error, { fallback: "Failed to update order.", context: "order status PATCH" });
  }

  const typedOrder = order as OrderWithConversation;
  const phone = typedOrder.conversations?.phone ?? null;
  const conversationId = typedOrder.conversation_id;
  const statusChanged = status !== undefined && status !== typedExistingOrder.status;
  if (statusChanged && status && status in STATUS_MESSAGES) {
    const profile = await getRestaurantProfile();
    const notificationMessage = STATUS_MESSAGES[status as keyof typeof STATUS_MESSAGES]
      .replace("{restaurant}", profile.app_name || "us")
      .replace("{support_phone}", profile.support_phone || profile.delivery_phone || "our support line");
    if (phone) {
      try {
        await sendAndPersistOutboundMessage({
          conversationId,
          phone,
          content: notificationMessage,
          senderKind: "system",
        });

        await supabaseAdmin
          .from("orders")
          .update({
            status_notified_at: new Date().toISOString(),
            status_notification_status: "sent",
            status_notification_error: null,
          })
          .eq("id", accessibleOrder.id);

        await resolveStaffAlerts(conversationId, "delivery_notification").catch((alertError) => {
          console.error("Failed to resolve delivery notification staff alerts", alertError);
        });
      } catch (notifyError) {
        const reason = notifyError instanceof Error ? notifyError.message : "Unknown notification error";
        await supabaseAdmin
          .from("orders")
          .update({
            status_notification_status: "failed",
            status_notification_error: reason,
          })
          .eq("id", accessibleOrder.id);
        await createDeliveryNotificationAlert({
          conversationId,
          branchId: typedOrder.branch_id,
          orderNumber: typedOrder.order_number,
          status,
          reason,
        });
      }
    } else {
      const reason = "Customer phone was unavailable for notification.";
      await supabaseAdmin
        .from("orders")
        .update({
          status_notification_status: "skipped",
          status_notification_error: reason,
        })
        .eq("id", accessibleOrder.id);
      await createDeliveryNotificationAlert({
        conversationId,
        branchId: typedOrder.branch_id,
        orderNumber: typedOrder.order_number,
        status,
        reason,
      });
    }
  }

  return NextResponse.json(order);
}
