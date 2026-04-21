import { useMemo, useState, useCallback, type ChangeEvent, type ClipboardEvent } from "react";
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
  Download,
  FileSpreadsheet,
  Calculator,
  Wand2,
  AlertTriangle,
  CheckCircle2,
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
            else if (ci === 2) patch.oferta = val.replace(/[^\d.,-]/g, "") || "0";
          }
          next[rowIndex + i] = { ...target, ...patch };
        }
        return next;
      });
    },
    [],
  );

  // Summary (sin alertas ni 10,5%)
  const summary = useMemo(() => {
    let validRows = 0;
    let totalNota = 0;
    let sumDescNuevo = 0;
    results.forEach((r) => {
      if (r.estado === "ok") {
        validRows++;
        if (r.notaCredito != null) totalNota += r.notaCredito;
        if (r.descuentoNuevoPct != null) sumDescNuevo += r.descuentoNuevoPct;
      }
    });
    return {
      validRows,
      totalNota,
      avgDescNuevo: validRows > 0 ? sumDescNuevo / validRows : 0,
    };
  }, [results]);

  const exportData = () => {
    return rows.map((r, i) => {
      const res = results[i];
      return {
        Codigo: r.codigo,
        "Precio Factura": r.precioFactura,
        "Oferta %": r.oferta,
        "10.5% (global)": globalHas105 ? "Sí" : "No",
        Modo: mode === "percent" ? "% final" : "Precio final",
        "% Final Deseado": mode === "percent" ? r.targetPercent : "",
        "Precio Final Deseado": mode === "price" ? r.targetPrice : "",
        "Precio Base": res.precioBase ?? "",
        "Precio Final Objetivo": res.precioFinalObjetivo ?? "",
        "% Descuento Total": res.descuentoTotalPct ?? "",
        "% Descuento Previo": res.descuentoPrevioPct ?? "",
        "% Descuento Nuevo": res.descuentoNuevoPct ?? "",
        "Nota de Crédito": res.notaCredito ?? "",
        Estado: res.estado,
        Observación: res.observacion,
      };
    });
  };

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(exportData());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Descuentos");
    XLSX.writeFile(wb, `descuentos_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportCsv = () => {
    const ws = XLSX.utils.json_to_sheet(exportData());
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `descuentos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-8">
      {/* Header */}
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
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
            <button
              type="button"
              onClick={() => setGlobalHas105((v) => !v)}
              className={cn(
                "flex items-center gap-3 rounded-xl border-2 px-5 py-3 text-left transition",
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
            </button>
          </div>
        </div>

        {/* Acciones secundarias */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button onClick={addRow} variant="outline" size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            Fila
          </Button>
          <Button
            onClick={deleteSelected}
            variant="outline"
            size="sm"
            disabled={selected.size === 0}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Borrar sel.
          </Button>
          <Button onClick={clearAll} variant="outline" size="sm">
            <Eraser className="mr-1.5 h-4 w-4" />
            Limpiar
          </Button>
          <div className="ml-auto flex gap-2">
            <Button onClick={exportXlsx} size="sm">
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              Excel
            </Button>
            <Button onClick={exportCsv} size="sm" variant="secondary">
              <Download className="mr-1.5 h-4 w-4" />
              CSV
            </Button>
          </div>
        </div>
      </section>

      {/* Summary */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryCard label="Filas válidas" value={summary.validRows.toString()} />
        <SummaryCard
          label="Total Nota de Crédito"
          value={`$ ${fmtMoney(summary.totalNota)}`}
          highlight
        />
        <SummaryCard label="Promedio desc. nuevo" value={fmtPct(summary.avgDescNuevo)} />
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
                <th className="px-3 py-3 text-left">Código</th>
                <th className="px-3 py-3 text-right">Precio Factura</th>
                <th className="px-3 py-3 text-right">Oferta %</th>
                <th className="px-3 py-3 text-right">
                  {mode === "percent" ? "% final ✱" : "% final"}
                </th>
                <th className="px-3 py-3 text-right">
                  {mode === "price" ? "Precio final ✱" : "Precio final"}
                </th>
                <th className="px-3 py-3 text-right">Precio Final Objetivo</th>
                <th className="px-3 py-3 text-right">% Desc. Total</th>
                <th className="px-3 py-3 text-right">% Desc. Nuevo</th>
                <th className="px-3 py-3 text-right">Nota Crédito</th>
                <th className="px-3 py-3 text-left">Observación</th>
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
                    <td className="px-1 py-1">
                      <input
                        className="cell-input h-10 text-base"
                        value={row.codigo}
                        onChange={(e) => updateRow(row.id, { codigo: e.target.value })}
                        onPaste={handlePaste(i, 0)}
                        placeholder="—"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        className="cell-input h-10 text-right font-mono text-base"
                        value={row.precioFactura}
                        onChange={(e) =>
                          updateRow(row.id, {
                            precioFactura: e.target.value.replace(/[^\d.,-]/g, ""),
                          })
                        }
                        onPaste={handlePaste(i, 1)}
                        inputMode="decimal"
                        placeholder="0,00"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        className="cell-input h-10 text-right font-mono text-base"
                        value={row.oferta}
                        onChange={(e) =>
                          updateRow(row.id, { oferta: e.target.value.replace(/[^\d.,-]/g, "") })
                        }
                        onPaste={handlePaste(i, 2)}
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        className={cn(
                          "cell-input h-10 text-right font-mono text-base",
                          mode !== "percent" && "opacity-50",
                        )}
                        value={row.targetPercent}
                        onChange={(e) =>
                          updateRow(row.id, {
                            targetPercent: e.target.value.replace(/[^\d.,-]/g, ""),
                          })
                        }
                        disabled={mode !== "percent"}
                        inputMode="decimal"
                        placeholder={mode === "percent" ? "20" : "—"}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        className={cn(
                          "cell-input h-10 text-right font-mono text-base",
                          mode !== "price" && "opacity-50",
                        )}
                        value={row.targetPrice}
                        onChange={(e) =>
                          updateRow(row.id, {
                            targetPrice: e.target.value.replace(/[^\d.,-]/g, ""),
                          })
                        }
                        disabled={mode !== "price"}
                        inputMode="decimal"
                        placeholder={mode === "price" ? "0,00" : "—"}
                      />
                    </td>
                    <ResultCells res={res} />
                    <td className="px-2">
                      <ObservationCell res={res} />
                    </td>
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
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "calc-card px-4 py-3",
        highlight &&
          "bg-gradient-to-br from-primary to-[oklch(0.4_0.1_220)] text-primary-foreground",
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

function ResultCells({ res }: { res: RowResult }) {
  return (
    <>
      <td className="result-cell result-cell-strong text-right text-base">
        {res.precioFinalObjetivo != null ? `$${fmtMoney(res.precioFinalObjetivo)}` : "—"}
      </td>
      <td className="result-cell text-right text-base">{fmtPct(res.descuentoTotalPct)}</td>
      <td className="result-cell result-cell-strong text-right text-base">
        {res.descuentoNuevoPct != null ? fmtPct(res.descuentoNuevoPct) : "—"}
      </td>
      <td className="result-cell text-right text-base">
        {res.notaCredito != null ? `$${fmtMoney(res.notaCredito)}` : "—"}
      </td>
    </>
  );
}

function ObservationCell({ res }: { res: RowResult }) {
  if (res.estado === "empty" && !res.observacion)
    return <span className="text-xs text-muted-foreground">—</span>;
  const cfg = {
    ok: {
      cls: "text-[oklch(0.45_0.12_155)] bg-[oklch(0.95_0.05_155)]",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
    warning: {
      cls: "text-[oklch(0.45_0.14_60)] bg-[oklch(0.96_0.07_75)]",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
    },
    error: {
      cls: "text-destructive bg-destructive/10",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
    },
    empty: {
      cls: "text-muted-foreground bg-muted",
      icon: null,
    },
  }[res.estado];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
        cfg.cls,
      )}
    >
      {cfg.icon}
      {res.observacion}
    </span>
  );
}
