import { createFileRoute } from "@tanstack/react-router";
import { DiscountCalculator } from "@/components/DiscountCalculator";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Calculadora de Notas de Credito" },
      {
        name: "description",
        content:
          "Calculadora administrativa para descuentos sobre artículos facturados, notas de crédito, recargo 10,5% y cálculo masivo tipo Excel.",
      },
    ],
  }),
});

function Index() {
  return <DiscountCalculator />;
}
