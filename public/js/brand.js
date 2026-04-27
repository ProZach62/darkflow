export const PRODUCT_NAME = 'Darkflow';
export const PRODUCT_TAGLINE = 'WebSocket client for Darkwind';

export function gameTitle(gameName) {
  return gameName ? PRODUCT_NAME + ' - ' + gameName : PRODUCT_NAME;
}
