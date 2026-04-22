export type CalcMode = "percent" | "price";

export interface Row {
  id: string;
  codigo: string;
  precioFactura: string; // raw input
  oferta: string; // %
  cantidad: string; // unidades
  has105: boolean;
  // per-row target (used when not using global)
  targetPercent: string;
  targetPrice: string;
}

export interface RowResult {
  precioBase: number | null;
  precioFacturadoVisible: number | null;
  precioFinalObjetivo: number | null;
  descuentoTotalPct: number | null;
  descuentoPrevioPct: number | null;
  descuentoNuevoPct: number | null;
  descuentoVisibleVsFacturadoPct: number | null;
  notaCredito: number | null; // diferencia entre precio facturado visible y precio final objetivo
  estado: "ok" | "empty" | "error" | "warning";
  observacion: string;
}

const parseNum = (v: string): number | null => {
  if (v === "" || v == null) return null;
  const cleaned = String(v).replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

export function computeRow(row: Row, mode: CalcMode): RowResult {
  const empty: RowResult = {
    precioBase: null,
    precioFacturadoVisible: null,
    precioFinalObjetivo: null,
    descuentoTotalPct: null,
    descuentoPrevioPct: null,
    descuentoNuevoPct: null,
    descuentoVisibleVsFacturadoPct: null,
    notaCredito: null,
    estado: "empty",
    observacion: "",
  };

  const precioBase = parseNum(row.precioFactura);
  const ofertaPrev = parseNum(row.oferta) ?? 0;

  // Si no hay nada cargado, fila vacía
  const targetPctRaw = parseNum(row.targetPercent);
  const targetPriceRaw = parseNum(row.targetPrice);
  const hasAnyInput =
    row.codigo.trim() !== "" ||
    row.precioFactura.trim() !== "" ||
    row.oferta.trim() !== "" ||
    row.cantidad.trim() !== "" ||
    row.targetPercent.trim() !== "" ||
    row.targetPrice.trim() !== "";

  if (!hasAnyInput) return empty;

  if (precioBase == null || precioBase <= 0) {
    return { ...empty, estado: "error", observacion: "Complete un Precio Factura válido (> 0)" };
  }
  if (ofertaPrev < 0) {
    return { ...empty, estado: "error", observacion: "La oferta previa no puede ser negativa" };
  }

  const precioFacturadoVisible = row.has105 ? precioBase * 1.105 : precioBase;

  let descuentoTotal: number | null = null;
  let precioFinalObjetivo: number | null = null;

  if (mode === "percent") {
    if (targetPctRaw == null) {
      return {
        ...empty,
        precioBase,
        precioFacturadoVisible,
        descuentoPrevioPct: ofertaPrev,
        estado: "empty",
        observacion: "Ingrese el % final deseado",
      };
    }
    if (targetPctRaw < 0 || targetPctRaw > 100) {
      return {
        ...empty,
        precioBase,
        precioFacturadoVisible,
        estado: "error",
        observacion: "El % final debe estar entre 0 y 100",
      };
    }
    descuentoTotal = targetPctRaw;
    precioFinalObjetivo = precioBase * (1 - descuentoTotal / 100);
  } else {
    if (targetPriceRaw == null) {
      return {
        ...empty,
        precioBase,
        precioFacturadoVisible,
        descuentoPrevioPct: ofertaPrev,
        estado: "empty",
        observacion: "Ingrese el precio final deseado",
      };
    }
    if (targetPriceRaw < 0 || targetPriceRaw > precioBase) {
      return {
        ...empty,
        precioBase,
        precioFacturadoVisible,
        estado: "error",
        observacion: "Precio final inválido (debe ser ≥ 0 y ≤ Precio Factura base)",
      };
    }
    precioFinalObjetivo = targetPriceRaw;
    descuentoTotal = (1 - precioFinalObjetivo / precioBase) * 100;
  }

  const descuentoNuevo = descuentoTotal - ofertaPrev;
  const descuentoVisible =
    ((precioFacturadoVisible - precioFinalObjetivo) / precioFacturadoVisible) * 100;
  const precioConOfertaPrevia = precioBase * (1 - ofertaPrev / 100);
  const cantidad = parseNum(row.cantidad);
  const qty = cantidad != null && cantidad > 0 ? cantidad : 1;
  const notaCredito = (precioConOfertaPrevia - precioFinalObjetivo) * qty;

  if (descuentoNuevo < -0.0001) {
    return {
      precioBase,
      precioFacturadoVisible,
      precioFinalObjetivo,
      descuentoTotalPct: descuentoTotal,
      descuentoPrevioPct: ofertaPrev,
      descuentoNuevoPct: descuentoNuevo,
      descuentoVisibleVsFacturadoPct: descuentoVisible,
      notaCredito,
      estado: "warning",
      observacion: "La oferta previa ya supera el descuento final buscado",
    };
  }

  return {
    precioBase,
    precioFacturadoVisible,
    precioFinalObjetivo,
    descuentoTotalPct: descuentoTotal,
    descuentoPrevioPct: ofertaPrev,
    descuentoNuevoPct: descuentoNuevo,
    descuentoVisibleVsFacturadoPct: descuentoVisible,
    notaCredito,
    estado: "ok",
    observacion: "OK",
  };
}

export const fmtMoney = (n: number | null, digits = 2) =>
  n == null
    ? "—"
    : n.toLocaleString("es-AR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

export const fmtPct = (n: number | null, digits = 2) =>
  n == null ? "—" : `${n.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

export const newEmptyRow = (): Row => ({
  id: crypto.randomUUID(),
  codigo: "",
  precioFactura: "",
  oferta: "",
  cantidad: "",
  has105: false,
  targetPercent: "",
  targetPrice: "",
});
