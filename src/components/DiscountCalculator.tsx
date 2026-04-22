import {
  useMemo,
  useState,
  useCallback,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import * as XLSX from "xlsx";
import {
  computeRow,
  fmtMoney,
  fmtPct,
  newEmptyRow,
  type CalcMode,
  type Row,
  type RowResult,
} from "@/lib/calc";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Plus,
  Trash2,
  Eraser,
  FileSpreadsheet,
  Calculator,
  Wand2,
} from "lucide-react";

const initialRows = (): Row[] => Array.from({ length: 10 }, () => newEmptyRow());

interface Props {
  // intentionally none
}

export function DiscountCalculator(_: Props = {}) {
  const [mode, setMode] = useState<CalcMode>("percent");
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPercent, setBulkPercent] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkTotalPrice, setBulkTotalPrice] = useState("");
  const [globalHas105, setGlobalHas105] = useState(false);

  // Refs for Excel-like keyboard navigation.
  // Editable input columns: 0 = codigo, 1 = precioFactura, 2 = oferta
  // Read-only result column for copy-only focus: 3 = % desc nuevo
  const cellRefs = useRef<Record<string, HTMLElement | null>>({});
  const cellKey = (r: number, c: number) => `${r}:${c}`;
  const setCellRef = (r: number, c: number) => (el: HTMLElement | null) => {
    cellRefs.current[cellKey(r, c)] = el;
  };
  const focusCell = (r: number, c: number) => {
    const el = cellRefs.current[cellKey(r, c)];
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
    }
  };

  // Apply global has105 to every row at compute-time
  const results = useMemo(
    () => rows.map((r) => computeRow({ ...r, has105: globalHas105 }, mode)),
    [rows, mode, globalHas105],
  );

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRow = () => setRows((rs) => [...rs, newEmptyRow()]);
  const deleteRow = (id: string) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  const clearAll = () => {
    setRows(initialRows());
    setSelected(new Set());
  };
  const deleteSelected = () => {
    if (selected.size === 0) return;
    setRows((rs) => {
      const filtered = rs.filter((r) => !selected.has(r.id));
      return filtered.length > 0 ? filtered : initialRows();
    });
    setSelected(new Set());
  };

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  const applyBulkPercent = () => {
    if (bulkPercent.trim() === "") return;
    setRows((rs) =>
      rs.map((r) => {
        if (selected.size > 0 && !selected.has(r.id)) return r;
        return { ...r, targetPercent: bulkPercent };
      }),
    );
  };

  const applyBulkPrice = () => {
    if (bulkPrice.trim() === "") return;
    setRows((rs) =>
      rs.map((r) => {
        if (selected.size > 0 && !selected.has(r.id)) return r;
        return { ...r, targetPrice: bulkPrice };
      }),
    );
  };

  // Apply a global TOTAL invoice price across selected (or all) valid rows.
  // Computes the uniform % discount needed so the sum of final prices equals the target total.
  const applyBulkTotalPrice = () => {
    const cleaned = bulkTotalPrice.replace(/\s/g, "").replace(",", ".");
    const target = Number(cleaned);
    if (!Number.isFinite(target) || target <= 0) return;

    // Determine eligible rows (with valid precioFactura). Compute per-row TOTAL = precio * cantidad
    const eligibleIds = new Set<string>();
    let sumBase = 0;
    rows.forEach((r) => {
      if (selected.size > 0 && !selected.has(r.id)) return;
      const base = Number(String(r.precioFactura).replace(/\s/g, "").replace(",", "."));
      const qtyRaw = Number(String(r.cantidad).replace(/\s/g, "").replace(",", "."));
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
      if (Number.isFinite(base) && base > 0) {
        eligibleIds.add(r.id);
        sumBase += base * qty;
      }
    });
    if (sumBase <= 0 || target > sumBase) return;
    const pct = (1 - target / sumBase) * 100;
    const pctStr = pct.toFixed(2);
    setMode("percent");
    setRows((rs) =>
      rs.map((r) => (eligibleIds.has(r.id) ? { ...r, targetPercent: pctStr } : r)),
    );
  };

  // Excel-like paste handler on the first cell of a row
  const handlePaste = useCallback(
    (rowIndex: number, colIndex: number) => (e: ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData("text");
      if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
      e.preventDefault();
      const lines = text
        .replace(/\r/g, "")
        .split("\n")
        .filter((l, i, a) => !(i === a.length - 1 && l === ""));
      const parsed = lines.map((l) => l.split("\t"));
      setRows((rs) => {
        const next = [...rs];
        while (next.length < rowIndex + parsed.length) next.push(newEmptyRow());
        for (let i = 0; i < parsed.length; i++) {
          const target = next[rowIndex + i];
          if (!target) continue;
          const cells = parsed[i];
          const patch: Partial<Row> = {};
          for (let j = 0; j < cells.length; j++) {
            const ci = colIndex + j;
            const val = cells[j].trim();
            if (ci === 0) patch.codigo = val;
            else if (ci === 1) patch.precioFactura = val.replace(/[^\d.,-]/g, "");
            else if (ci === 2) patch.oferta = val.replace(/[^\d.,-]/g, "");
            else if (ci === 3) patch.cantidad = val.replace(/[^\d.,-]/g, "");
          }
          next[rowIndex + i] = { ...target, ...patch };
        }
        return next;
      });
    },
    [],
  );

  // Excel-like keyboard navigation across cells.
  // Columns: 0 = codigo, 1 = precioFactura, 2 = oferta, 3 = cantidad, 4 = % desc nuevo (read-only)
  const TOTAL_COLS = 5;
  const handleCellKeyDown =
    (rowIndex: number, colIndex: number) => (e: KeyboardEvent<HTMLElement>) => {
      const totalRows = rows.length;
      const move = (dr: number, dc: number) => {
        let r = rowIndex + dr;
        let c = colIndex + dc;
        if (c < 0) {
          c = TOTAL_COLS - 1;
          r -= 1;
        } else if (c >= TOTAL_COLS) {
          c = 0;
          r += 1;
        }
        if (r < 0 || r >= totalRows) return;
        e.preventDefault();
        focusCell(r, c);
      };
      if (e.key === "Tab") {
        move(0, e.shiftKey ? -1 : 1);
      } else if (e.key === "Enter") {
        move(e.shiftKey ? -1 : 1, 0);
      } else if (e.key === "ArrowDown") {
        move(1, 0);
      } else if (e.key === "ArrowUp") {
        move(-1, 0);
      } else if (e.key === "ArrowLeft") {
        const el = e.currentTarget;
        if (el instanceof HTMLInputElement && el.selectionStart !== 0) return;
        move(0, -1);
      } else if (e.key === "ArrowRight") {
        const el = e.currentTarget;
        if (el instanceof HTMLInputElement && el.selectionEnd !== el.value.length) return;
        move(0, 1);
      }
    };

  // Summary: "Articulos" cuenta filas completadas (con código o precio factura)
  const summary = useMemo(() => {
    let articulos = 0;
    let okRows = 0;
    let totalNota = 0;
    let sumDescNuevo = 0;
    let totalInicial = 0;
    rows.forEach((r, i) => {
      const filled = r.codigo.trim() !== "" || r.precioFactura.trim() !== "";
      if (filled) articulos++;
      const base = Number(String(r.precioFactura).replace(/\s/g, "").replace(",", "."));
      const qtyRaw = Number(String(r.cantidad).replace(/\s/g, "").replace(",", "."));
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
      if (Number.isFinite(base) && base > 0) totalInicial += base * qty;
      const res = results[i];
      if (res.estado === "ok") {
        okRows++;
        if (res.notaCredito != null) totalNota += res.notaCredito;
        if (res.descuentoNuevoPct != null) sumDescNuevo += res.descuentoNuevoPct;
      }
    });
    return {
      articulos,
      totalNota,
      avgDescNuevo: okRows > 0 ? sumDescNuevo / okRows : 0,
      totalInicial,
    };
  }, [results, rows]);

  const exportData = () => {
    return rows
      .map((r, i) => {
        const res = results[i];
        return {
          Codigo: r.codigo,
          "Descuento a cargar %":
            res.descuentoNuevoPct != null ? -Math.abs(Number(res.descuentoNuevoPct.toFixed(2))) : "",
          "Nota credito a cargar":
            res.notaCredito != null ? Number(res.notaCredito.toFixed(2)) : "",
        };
      })
      .filter((r) => r.Codigo !== "" || r["Nota credito a cargar"] !== "");
  };

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(exportData());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Descuentos");
    XLSX.writeFile(wb, `descuentos_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-8">
      {/* Header */}
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-sm">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Calculadora de Descuentos & Notas de Crédito
            </h1>
            <p className="text-sm text-muted-foreground">
              Cálculo exacto sobre precio base, edición tipo Excel.
            </p>
          </div>
        </div>
      </header>

      {/* Config panel */}
      <section className="calc-card p-6">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr_auto]">
          {/* Modo */}
          <div>
            <Label className="mb-3 block text-xs uppercase tracking-wider text-muted-foreground">
              Modo de cálculo
            </Label>
            <div className="inline-flex rounded-xl border bg-muted p-1.5">
              <button
                onClick={() => setMode("percent")}
                className={cn(
                  "rounded-lg px-6 py-2.5 text-base font-medium transition",
                  mode === "percent"
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Descuento final deseado
              </button>
              <button
                onClick={() => setMode("price")}
                className={cn(
                  "rounded-lg px-6 py-2.5 text-base font-medium transition",
                  mode === "price"
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Precio final deseado
              </button>
            </div>
          </div>

          {/* Acciones masivas - dos filas */}
          <div>
            <Label className="mb-3 block text-xs uppercase tracking-wider text-muted-foreground">
              Acciones masivas {selected.size > 0 ? `(${selected.size} fila/s)` : "(todas)"}
            </Label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={bulkPercent}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setBulkPercent(e.target.value)}
                  placeholder="% descuento final — Ej: 20"
                  inputMode="decimal"
                />
                <Button onClick={applyBulkPercent} variant="secondary">
                  <Wand2 className="mr-1.5 h-4 w-4" />
                  Aplicar %
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  value={bulkPrice}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setBulkPrice(e.target.value)}
                  placeholder="Precio final — Ej: 7000"
                  inputMode="decimal"
                />
                <Button onClick={applyBulkPrice} variant="secondary">
                  <Wand2 className="mr-1.5 h-4 w-4" />
                  Aplicar precio
                </Button>
              </div>
            </div>
          </div>

          {/* Global 10,5% switch */}
          <div className="flex flex-col">
            <Label className="mb-3 block text-xs uppercase tracking-wider text-muted-foreground">
              Recargo global
            </Label>
            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl border-2 px-5 py-3 text-left transition",
                globalHas105
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/30 hover:bg-muted/60",
              )}
            >
              <Switch checked={globalHas105} onCheckedChange={setGlobalHas105} />
              <div>
                <div className="text-base font-semibold leading-tight">10,5%</div>
                <div className="text-xs text-muted-foreground">
                  {globalHas105 ? "Aplicado a todas las filas" : "Sin aplicar"}
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Acciones secundarias */}
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button onClick={addRow} variant="outline" size="lg" className="text-base">
            <Plus className="mr-2 h-5 w-5" />
            Agregar fila
          </Button>
          <Button
            onClick={deleteSelected}
            variant="outline"
            size="lg"
            className="text-base"
            disabled={selected.size === 0}
          >
            <Trash2 className="mr-2 h-5 w-5" />
            Borrar selección
          </Button>
          <Button onClick={clearAll} variant="outline" size="lg" className="text-base">
            <Eraser className="mr-2 h-5 w-5" />
            Limpiar todo
          </Button>
          <div className="ml-auto flex gap-3">
            <Button onClick={exportXlsx} size="lg" className="text-base">
              <FileSpreadsheet className="mr-2 h-5 w-5" />
              Excel
            </Button>
          </div>
        </div>
      </section>

      {/* Summary */}
      <section className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Artículos" value={String(summary.articulos ?? 0)} />
        <SummaryCard label="Total Inicial" value={`$ ${fmtMoney(summary.totalInicial)}`} />
        <SummaryCard
          label="Total Nota de Crédito"
          value={`$ ${fmtMoney(summary.totalNota)}`}
          highlight
        />
        <TotalInvoiceCard
          value={bulkTotalPrice}
          onChange={setBulkTotalPrice}
          onApply={applyBulkTotalPrice}
        />
      </section>

      {/* Table */}
      <section className="calc-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-base">
            <thead>
              <tr className="bg-secondary text-xs uppercase tracking-wider text-muted-foreground">
                <th className="w-10 px-2 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={toggleAll}
                    className="h-4 w-4 cursor-pointer rounded border-border accent-[var(--primary)]"
                  />
                </th>
                <th className="w-10 px-2 py-3 text-center">#</th>
                <th className="col-input-bg px-3 py-3 text-left">Código</th>
                <th className="col-input-bg px-3 py-3 text-right">
                  <div>Precio Inicial</div>
                  <div className="mt-0.5 font-mono text-[11px] font-semibold normal-case tracking-normal text-foreground">
                    Total: $ {fmtMoney(summary.totalInicial)}
                  </div>
                </th>
                <th className="col-input-bg px-3 py-3 text-right">Oferta previa</th>
                <th className="col-input-bg px-3 py-3 text-right">Cantidad</th>
                <th
                  className={cn(
                    "px-3 py-3 text-right",
                    mode !== "percent" && "bg-foreground text-background",
                  )}
                >
                  Descuento total %
                </th>
                <th
                  className={cn(
                    "px-3 py-3 text-right",
                    mode !== "price" && "bg-foreground text-background",
                  )}
                >
                  Precio a pagar
                </th>
                <th className="px-3 py-3 text-right">Saldo total</th>
                <th className="col-result-bg px-3 py-3 text-right">Descuento a cargar %</th>
                <th className="col-result-bg px-3 py-3 text-right">Nota credito a cargar</th>
                <th className="w-10 px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const res = results[i];
                const isSelected = selected.has(row.id);
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-t border-border transition-colors",
                      isSelected ? "bg-accent/40" : "hover:bg-muted/50",
                      res.estado === "error" && "bg-destructive/5",
                      res.estado === "warning" && "bg-[oklch(0.98_0.04_75)]",
                    )}
                  >
                    <td className="px-2 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(row.id)}
                        className="h-4 w-4 cursor-pointer rounded border-border accent-[var(--primary)]"
                      />
                    </td>
                    <td className="px-2 text-center text-xs text-muted-foreground">{i + 1}</td>
                    <td className="col-input-bg px-1 py-1">
                      <input
                        ref={setCellRef(i, 0)}
                        className="cell-input h-10 text-base"
                        value={row.codigo}
                        onChange={(e) => updateRow(row.id, { codigo: e.target.value })}
                        onPaste={handlePaste(i, 0)}
                        onKeyDown={handleCellKeyDown(i, 0)}
                        placeholder="—"
                      />
                    </td>
                    <td className="col-input-bg px-1 py-1">
                      <input
                        ref={setCellRef(i, 1)}
                        className="cell-input h-10 text-right font-mono text-base"
                        value={row.precioFactura}
                        onChange={(e) =>
                          updateRow(row.id, {
                            precioFactura: e.target.value.replace(/[^\d.,-]/g, ""),
                          })
                        }
                        onPaste={handlePaste(i, 1)}
                        onKeyDown={handleCellKeyDown(i, 1)}
                        inputMode="decimal"
                        placeholder="—"
                      />
                    </td>
                    <td className="col-input-bg px-1 py-1">
                      <input
                        ref={setCellRef(i, 2)}
                        className="cell-input h-10 text-right font-mono text-base"
                        value={row.oferta}
                        onChange={(e) =>
                          updateRow(row.id, { oferta: e.target.value.replace(/[^\d.,-]/g, "") })
                        }
                        onPaste={handlePaste(i, 2)}
                        onKeyDown={handleCellKeyDown(i, 2)}
                        inputMode="decimal"
                        placeholder="—"
                      />
                    </td>
                    <td className="col-input-bg px-1 py-1">
                      <input
                        ref={setCellRef(i, 3)}
                        className="cell-input h-10 text-right font-mono text-base"
                        value={row.cantidad}
                        onChange={(e) =>
                          updateRow(row.id, { cantidad: e.target.value.replace(/[^\d.,-]/g, "") })
                        }
                        onPaste={handlePaste(i, 3)}
                        onKeyDown={handleCellKeyDown(i, 3)}
                        inputMode="decimal"
                        placeholder="—"
                      />
                    </td>
                    <td
                      className={cn("px-1 py-1", mode !== "percent" && "bg-foreground")}
                    >
                      <input
                        className={cn(
                          "cell-input h-10 text-right font-mono text-base",
                          mode !== "percent" && "text-background opacity-60",
                        )}
                        value={row.targetPercent}
                        onChange={(e) =>
                          updateRow(row.id, {
                            targetPercent: e.target.value.replace(/[^\d.,-]/g, ""),
                          })
                        }
                        disabled={mode !== "percent"}
                        inputMode="decimal"
                        placeholder={mode === "percent" ? "—" : ""}
                      />
                    </td>
                    <td
                      className={cn("px-1 py-1", mode !== "price" && "bg-foreground")}
                    >
                      <input
                        className={cn(
                          "cell-input h-10 text-right font-mono text-base",
                          mode !== "price" && "text-background opacity-60",
                        )}
                        value={row.targetPrice}
                        onChange={(e) =>
                          updateRow(row.id, {
                            targetPrice: e.target.value.replace(/[^\d.,-]/g, ""),
                          })
                        }
                        disabled={mode !== "price"}
                        inputMode="decimal"
                        placeholder={mode === "price" ? "—" : ""}
                      />
                    </td>
                    <ResultCells
                      res={res}
                      descNuevoRef={setCellRef(i, 4)}
                      onDescNuevoKeyDown={handleCellKeyDown(i, 4)}
                    />
                    <td className="px-2 text-center">
                      <button
                        onClick={() => deleteRow(row.id)}
                        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Eliminar fila"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          Tip: copiá un bloque desde Excel (Código · Precio Factura · Oferta) y pegalo en cualquier
          celda — la tabla se expande automáticamente.
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
  compact,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "calc-card px-4 py-3",
        compact && "min-w-[140px]",
        highlight &&
          "bg-gradient-to-br from-primary to-[oklch(0.4_0.1_220)] text-primary-foreground",
        className,
      )}
    >
      <div
        className={cn(
          "text-[10px] font-medium uppercase tracking-wider",
          highlight ? "text-primary-foreground/70" : "text-muted-foreground",
        )}
      >
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ResultCells({
  res,
  descNuevoRef,
  onDescNuevoKeyDown,
}: {
  res: RowResult;
  descNuevoRef?: (el: HTMLElement | null) => void;
  onDescNuevoKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const fmtPlain = (n: number, digits = 2) =>
    n.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const descText =
    res.descuentoNuevoPct != null ? `-${fmtPlain(Math.abs(res.descuentoNuevoPct))}` : "—";
  const notaText = res.notaCredito != null ? fmtPlain(res.notaCredito) : "—";
  const copyOnFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const range = document.createRange();
    range.selectNodeContents(e.currentTarget);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  return (
    <>
      <td className="result-cell result-cell-strong text-right text-base">
        {res.precioFinalObjetivo != null ? `$${fmtMoney(res.precioFinalObjetivo)}` : "—"}
      </td>
      <td className="col-result-bg p-0">
        <div
          ref={descNuevoRef as (el: HTMLDivElement | null) => void}
          tabIndex={0}
          role="textbox"
          aria-readonly="true"
          onKeyDown={onDescNuevoKeyDown}
          onFocus={copyOnFocus}
          className="result-copy-cell"
          title="Solo lectura — usá Ctrl+C para copiar"
        >
          {descText}
        </div>
      </td>
      <td className="col-result-bg p-0">
        <div
          tabIndex={0}
          role="textbox"
          aria-readonly="true"
          onFocus={copyOnFocus}
          className="result-copy-cell"
          title="Solo lectura — usá Ctrl+C para copiar"
        >
          {notaText}
        </div>
      </td>
    </>
  );
}

function TotalInvoiceCard({
  value,
  onChange,
  onApply,
}: {
  value: string;
  onChange: (v: string) => void;
  onApply: () => void;
}) {
  return (
    <div className="calc-card flex flex-col gap-2 px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Precio Factura Total
      </div>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onApply();
            }
          }}
          placeholder="Ej: 50000"
          inputMode="decimal"
          className="h-9 font-mono"
        />
        <Button onClick={onApply} size="sm" variant="secondary">
          <Wand2 className="mr-1 h-4 w-4" />
          Aplicar
        </Button>
      </div>
      <div className="text-[11px] text-muted-foreground">
        Distribuye el % proporcional para igualar el total.
      </div>
    </div>
  );
}
