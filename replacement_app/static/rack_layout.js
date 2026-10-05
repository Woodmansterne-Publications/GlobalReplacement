const STANDARD_CARD_WIDTH_MM = 129;
const STANDARD_CARD_HEIGHT_MM = 180;
const RACK_GAP_MM = 10;
const RACK_MAX_HEIGHT_PX = 390;
const RACK_LABEL_HEIGHT_PX = 32;

function positive_dimension(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function pocket_key(slot) {
  return `${slot.tier}:${slot.position}`;
}

function positioned_slots(slots, target_material) {
  return (slots || []).filter((slot) => [slot.tier, slot.position].every(
    (value) => value != null && String(value).trim() !== "" && Number.isSafeInteger(Number(value))
  )).map((slot) => ({
    ...slot,
    tier: Number(slot.tier),
    position: Number(slot.position),
    width_mm: positive_dimension(slot.width_mm, STANDARD_CARD_WIDTH_MM),
    height_mm: positive_dimension(slot.height_mm, STANDARD_CARD_HEIGHT_MM),
    is_target: Boolean(slot.is_target) || String(slot.material) === String(target_material),
  })).sort((left, right) => right.tier - left.tier || left.position - right.position);
}

function coordinate_window(values, focus) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const count = Math.min(3, maximum - minimum + 1);
  const start = Math.max(minimum, Math.min(focus - 1, maximum - count + 1));
  return Array.from({ length: count }, (_, index) => start + index);
}

function rack_neighbourhood(slots, target_material, selected_key) {
  const positioned = positioned_slots(slots, target_material);
  const targets = positioned.filter((slot) => slot.is_target);
  const selected = targets.find((slot) => pocket_key(slot) === selected_key) || targets[0];
  if (!selected) return null;
  const tiers = coordinate_window(positioned.map((slot) => slot.tier), selected.tier).reverse();
  const positions = coordinate_window(positioned.map((slot) => slot.position), selected.position);
  const grid = new Map(positioned.map((slot) => [pocket_key(slot), slot]));
  const cells = tiers.map((tier) => positions.map((position) => grid.get(`${tier}:${position}`)));
  const column_widths = positions.map((_, index) => Math.max(
    STANDARD_CARD_WIDTH_MM, ...cells.map((row) => row[index]?.width_mm || 0)
  ));
  const row_heights = cells.map((row) => Math.max(
    STANDARD_CARD_HEIGHT_MM, ...row.map((slot) => slot?.height_mm || 0)
  ));
  return {
    tiers, positions, cells, targets, selected, column_widths, row_heights,
    width_mm: column_widths.reduce((sum, width) => sum + width, 0) + (positions.length - 1) * RACK_GAP_MM,
    height_mm: row_heights.reduce((sum, height) => sum + height, 0) + (tiers.length - 1) * RACK_GAP_MM,
  };
}

function rack_scale(layout, available_width, available_height = RACK_MAX_HEIGHT_PX) {
  return Math.max(0, Math.min(
    available_width / layout.width_mm,
    (available_height - 16 - layout.tiers.length * RACK_LABEL_HEIGHT_PX) / layout.height_mm
  ));
}
