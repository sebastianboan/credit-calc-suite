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
  const [bulkValue, setBulkValue] = useState("");

  const results = useMemo(() => rows.map((r) => computeRow(r, mode)), [rows, mode]);

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

  const applyBulk = () => {
    if (bulkValue.trim() === "") return;
    setRows((rs) =>
      rs.map((r) => {
        if (selected.size > 0 && !selected.has(r.id)) return r;
        return mode === "percent"
          ? { ...r, targetPercent: bulkValue }
          : { ...r, targetPrice: bulkValue };
      }),
    );
  };

  // Excel-like paste handler on the first cell of a row
  const handlePaste = useCallback(
    (rowIndex: number, colIndex: number) => (e: ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData("text");
      if (!text || (!text.includes("\t") && !text.includes("\n"))) return; // single cell, default behavior
      e.preventDefault();
      const lines = text.replace(/\r/g, "").split("\n").filter((l, i, a) => !(i === a.length - 1 && l === ""));
      const parsed = lines.map((l) => l.split("\t"));
      // columns mapping starting at colIndex: 0=codigo,1=precio,2=oferta
      setRows((rs) => {
        const next = [...rs];
        // ensure capacity
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

  // Summary
  const summary = useMemo(() => {
    let validRows = 0;
    let totalNota = 0;
    let sumDescNuevo = 0;
    let count105 = 0;
    let alerts = 0;
    results.forEach((r) => {
      if (r.estado === "ok") {
        validRows++;
        if (r.notaCredito != null) totalNota += r.notaCredito;
        if (r.descuentoNuevoPct != null) sumDescNuevo += r.descuentoNuevoPct;
      }
      if (r.estado === "warning" || r.estado === "error") alerts++;
    });
    rows.forEach((r) => {
      if (r.has105) count105++;
    });
    return {
      validRows,
      totalNota,
      avgDescNuevo: validRows > 0 ? sumDescNuevo / validRows : 0,
      count105,
      alerts,
    };
  }, [results, rows]);

  const exportData = () => {
    return rows.map((r, i) => {
      const res = results[i];
      return {
        Codigo: r.codigo,
        "Precio Factura": r.precioFactura,
        "Oferta %": r.oferta,
        "10.5%": r.has105 ? "Sí" : "No",
        Modo: mode === "percent" ? "% final" : "Precio final",
        "% Final Deseado": mode === "percent" ? r.targetPercent : "",
        "Precio Final Deseado": mode === "price" ? r.targetPrice : "",
        "Precio Facturado Visible": res.precioFacturadoVisible ?? "",
        "Precio Base": res.precioBase ?? "",
        "Precio Final Objetivo": res.precioFinalObjetivo ?? "",
        "% Descuento Total": res.descuentoTotalPct ?? "",
        "% Descuento Previo": res.descuentoPrevioPct ?? "",
        "% Descuento Nuevo": res.descuentoNuevoPct ?? "",
        "% Visible vs Facturado": res.descuentoVisibleVsFacturadoPct ?? "",
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
              Cálculo exacto sobre precio base, soporte 10,5%, edición tipo Excel.
            </p>
          </div>
        </div>
      </header>

      {/* Config panel */}
      <section className="calc-card p-5">
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <Label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
              Modo de cálculo
            </Label>
            <div className="inline-flex rounded-lg border bg-muted p-1">
              <button
                onClick={() => setMode("percent")}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-medium transition",
                  mode === "percent"
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                % final deseado
              </button>
              <button
                onClick={() => setMode("price")}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-medium transition",
                  mode === "price"
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Precio final deseado
              </button>
            </div>
          </div>

          <div>
            <Label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
              Acción masiva {selected.size > 0 ? `(${selected.size} fila/s)` : "(todas)"}
            </Label>
            <div className="flex gap-2">
              <Input
                value={bulkValue}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setBulkValue(e.target.value)}
                placeholder={mode === "percent" ? "Ej: 20" : "Ej: 7000"}
                inputMode="decimal"
              />
              <Button onClick={applyBulk} variant="secondary">
                <Wand2 className="mr-1.5 h-4 w-4" />
                Aplicar
              </Button>
            </div>
          </div>

          <div>
            <Label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
              Acciones
            </Label>
            <div className="flex flex-wrap gap-2">
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
        </div>
      </section>

      {/* Summary */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryCard label="Filas válidas" value={summary.validRows.toString()} />
        <SummaryCard
          label="Total Nota de Crédito"
          value={`$ ${fmtMoney(summary.totalNota)}`}
          highlight
        />
        <SummaryCard
          label="Promedio desc. nuevo"
          value={fmtPct(summary.avgDescNuevo)}
        />
        <SummaryCard label="Artículos con 10,5%" value={summary.count105.toString()} />
        <SummaryCard
          label="Alertas"
          value={summary.alerts.toString()}
          tone={summary.alerts > 0 ? "warning" : "ok"}
        />
      </section>

      {/* Table */}
      <section className="calc-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
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
                <th className="px-2 py-3 text-left">Código</th>
                <th className="px-2 py-3 text-right">Precio Factura</th>
                <th className="px-2 py-3 text-right">Oferta %</th>
                <th className="w-16 px-2 py-3 text-center">10,5%</th>
                <th className="px-2 py-3 text-right">
                  {mode === "percent" ? "% final ✱" : "% final"}
                </th>
                <th className="px-2 py-3 text-right">
                  {mode === "price" ? "Precio final ✱" : "Precio final"}
                </th>
                <th className="px-2 py-3 text-right">Precio Fact. Visible</th>
                <th className="px-2 py-3 text-right">Precio Final Objetivo</th>
                <th className="px-2 py-3 text-right">% Desc. Total</th>
                <th className="px-2 py-3 text-right">% Desc. Nuevo</th>
                <th className="px-2 py-3 text-right">% Visible vs Fact.</th>
                <th className="px-2 py-3 text-right">Nota Crédito</th>
                <th className="px-2 py-3 text-left">Observación</th>
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
                    <td className="px-1">
                      <input
                        className="cell-input"
                        value={row.codigo}
                        onChange={(e) => updateRow(row.id, { codigo: e.target.value })}
                        onPaste={handlePaste(i, 0)}
                        placeholder="—"
                      />
                    </td>
                    <td className="px-1">
                      <input
                        className="cell-input text-right font-mono"
                        value={row.precioFactura}
                        onChange={(e) =>
                          updateRow(row.id, { precioFactura: e.target.value.replace(/[^\d.,-]/g, "") })
                        }
                        onPaste={handlePaste(i, 1)}
                        inputMode="decimal"
                        placeholder="0,00"
                      />
                    </td>
                    <td className="px-1">
                      <input
                        className="cell-input text-right font-mono"
                        value={row.oferta}
                        onChange={(e) =>
                          updateRow(row.id, { oferta: e.target.value.replace(/[^\d.,-]/g, "") })
                        }
                        onPaste={handlePaste(i, 2)}
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-2 text-center">
                      <Switch
                        checked={row.has105}
                        onCheckedChange={(v) => updateRow(row.id, { has105: v })}
                      />
                    </td>
                    <td className="px-1">
                      <input
                        className={cn("cell-input text-right font-mono", mode !== "percent" && "opacity-50")}
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
                    <td className="px-1">
                      <input
                        className={cn("cell-input text-right font-mono", mode !== "price" && "opacity-50")}
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
                    <ResultCells res={res} has105={row.has105} />
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
          Tip: copiá un bloque desde Excel (Código · Precio Factura · Oferta) y pegalo en cualquier celda — la tabla se expande automáticamente.
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
  tone,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: "ok" | "warning";
}) {
  return (
    <div
      className={cn(
        "calc-card px-4 py-3",
        highlight && "bg-gradient-to-br from-primary to-[oklch(0.4_0.1_220)] text-primary-foreground",
        tone === "warning" && "border-[var(--warning)]",
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
      <div
        className={cn(
          "mt-1 font-mono text-lg font-semibold tabular-nums",
          tone === "warning" && "text-[oklch(0.55_0.18_60)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ResultCells({ res, has105 }: { res: RowResult; has105: boolean }) {
  return (
    <>
      <td className="result-cell text-right">
        {res.precioFacturadoVisible != null ? (
          <span className={cn(has105 && "text-[oklch(0.5_0.12_220)]")}>
            ${fmtMoney(res.precioFacturadoVisible)}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="result-cell result-cell-strong text-right">
        {res.precioFinalObjetivo != null ? `$${fmtMoney(res.precioFinalObjetivo)}` : "—"}
      </td>
      <td className="result-cell text-right">{fmtPct(res.descuentoTotalPct)}</td>
      <td className="result-cell result-cell-strong text-right">
        {res.descuentoNuevoPct != null ? fmtPct(res.descuentoNuevoPct) : "—"}
      </td>
      <td className="result-cell text-right">{fmtPct(res.descuentoVisibleVsFacturadoPct)}</td>
      <td className="result-cell text-right">
        {res.notaCredito != null ? `$${fmtMoney(res.notaCredito)}` : "—"}
      </td>
    </>
  );
}

function ObservationCell({ res }: { res: RowResult }) {
  if (res.estado === "empty" && !res.observacion) return <span className="text-xs text-muted-foreground">—</span>;
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
