export const DETAILS_CARD_CLEARANCE = 32;

/** The chat lane: centered, and kept left of an open details card. */
export function resolveChatCanvasLayout({
  container,
  padding = 48,
  maxChatWidth = 768,
  detailsCard = null,
}: {
  container: { width: number; height: number };
  padding?: number;
  maxChatWidth?: number;
  detailsCard?: { left: number; right: number; bottom: number } | null;
}) {
  const centeredWidth = Math.max(0, Math.min(maxChatWidth, container.width - padding * 2));
  const laneRight = detailsCard
    ? detailsCard.left - DETAILS_CARD_CLEARANCE
    : container.width - padding;
  const width = Math.max(0, Math.min(centeredWidth, laneRight - padding));
  const canvasCenterLeft = (container.width - width) / 2;
  const left = Math.max(padding, Math.min(canvasCenterLeft, laneRight - width));
  return {
    chat: {
      left,
      width,
      insetStart: 0,
      insetEnd: Math.max(0, container.width - left * 2 - width),
    },
  };
}
