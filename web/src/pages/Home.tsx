import { useEffect, useMemo, useState } from "react";
import { Doughnut } from "react-chartjs-2";
import "../lib/charts";
import BalanceComposition from "../components/BalanceComposition";
import Kpi from "../components/Kpi";
import Seg from "../components/Seg";
import TimeSeriesChart from "../components/TimeSeriesChart";
import { loadMeta, loadTasasMercado, type TasasMercado } from "../lib/data";
import { deflateSeries } from "../lib/deflate";
import { fmtValue, GROUP_LABELS, num, PALETTE, pct, periodLabel, shiftPeriod } from "../lib/format";
import { useCore } from "../lib/store";
import { chartColors, useTheme } from "../lib/theme";
import type { EntityMeta } from "../lib/types";

const KPI_MONEY = ["activo", "depositos", "prestamos", "patrimonio"];

export default function Home() {
  const { index, system, ipc } = useCore();
  const { theme } = useTheme();
  const cc = chartColors(theme);
  const [mode, setMode] = useState<"nominal" | "real">("nominal");
  const [metric, setMetric] = useState("activo");
  const [showGroups, setShowGroups] = useState(true);
  const [compMeta, setCompMeta] = useState<EntityMeta | null>(null);
  const [compGroup, setCompGroup] = useState<"AA000" | "AA110" | "AA120">("AA000");

  const periods = system.periods;
  const last = periods.length - 1;
  const latest = periods[last];
  // los huecos de publicación del BCRA obligan a buscar el período por valor, no por offset
  const idxPrevMonth = periods.indexOf(shiftPeriod(latest, -1));
  const idxPrevYear = periods.indexOf(shiftPeriod(latest, -12));
  const canReal = ipc != null;
  const real = mode === "real" && canReal;

  useEffect(() => {
    loadMeta(compGroup).then(setCompMeta).catch(() => setCompMeta(null));
  }, [compGroup]);

  // tasas de mercado (API del BCRA): último dato diario, que es más reciente que el balance
  const [tasas, setTasas] = useState<TasasMercado["series"]>({});
  useEffect(() => {
    loadTasasMercado().then((t) => setTasas(t.series)).catch(() => setTasas({}));
  }, []);

  // tarjeta de una tasa de mercado; si no se pudo cargar, la tasa implícita del balance
  const tasaCard = (serie: string, label: string, respaldo: [string, string]) => {
    const t = tasas[serie];
    if (!t?.ultimo) return kpiCard(respaldo[0], false, respaldo[1]);
    return (
      <Kpi
        key={serie}
        label={`${label} · Último dato`}
        unit="pct"
        value={t.ultimo.valor}
        digits={3}
        prevMonth={t.hace_un_mes}
        prevYear={t.hace_un_anio}
      />
    );
  };

  const seriesOf = (gcode: string, key: string) => {
    const raw = system.groups[gcode]?.[key] ?? [];
    const unit = index.metrics[key]?.unit;
    if (real && unit === "miles_pesos" && ipc) return deflateSeries(raw, periods, ipc, latest);
    return raw;
  };

  const aa000 = (key: string) => seriesOf("AA000", key);

  const metricDef = index.metrics[metric];
  const chartDatasets = useMemo(() => {
    const groups = showGroups ? ["AA000", "AA110", "AA120"] : ["AA000"];
    return groups.map((g, i) => ({
      label: GROUP_LABELS[g],
      values: seriesOf(g, metric),
      color: PALETTE[i],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, showGroups, real, system]);

  // participación en el activo del último período
  const shareData = useMemo(() => {
    const act = (g: string) => system.groups[g]?.activo?.[last] ?? null;
    const sys = act("AA000") ?? 0;
    const pub = act("AA110") ?? 0;
    const priv = act("AA120") ?? 0;
    const resto = Math.max(sys - pub - priv, 0);
    return {
      labels: ["Bancos públicos", "Bancos privados", "Cías. financieras"],
      values: sys ? [100 * pub / sys, 100 * priv / sys, 100 * resto / sys] : [0, 0, 0],
    };
  }, [system, last]);

  const kpiCard = (key: string, invert?: boolean, labelOverride?: string) => {
    const def = index.metrics[key];
    const s = aa000(key);
    return (
      <Kpi
        key={key}
        label={labelOverride ?? def.label}
        unit={def.unit}
        value={s[last] ?? null}
        prevMonth={idxPrevMonth >= 0 ? s[idxPrevMonth] : null}
        prevYear={idxPrevYear >= 0 ? s[idxPrevYear] : null}
        invert={invert}
      />
    );
  };

  // Préstamos / Depósitos del sistema (derivado; ratio sin unidad → igual en nominal o real)
  const pdSeries = useMemo(() => {
    const pr = system.groups.AA000?.prestamos ?? [];
    const dep = system.groups.AA000?.depositos ?? [];
    return pr.map((v, i) => (v != null && dep[i]) ? (100 * v) / (dep[i] as number) : null);
  }, [system]);

  const breakNote = index.series_breaks[metric];

  return (
    <>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="pagetitle">Sistema financiero argentino</h1>
          <div className="pagesub">
            Bancos y compañías financieras · datos oficiales BCRA · {periodLabel(latest, true)}
          </div>
        </div>
        <div className="controls" style={{ marginBottom: 0 }}>
          <Seg
            options={[
              { value: "nominal", label: "$ corrientes" },
              { value: "real", label: `$ constantes${canReal ? "" : " (n/d)"}` },
            ]}
            value={mode}
            onChange={(v) => canReal && setMode(v)}
          />
        </div>
      </header>

      <section>
        <p className="stitle">Totales del sistema · variación intermensual e interanual</p>
        <div className="kpis big4">{KPI_MONEY.map((k) => kpiCard(k))}</div>
        <div className="kpis sm5">
          {kpiCard("mora", true)}
          {kpiCard("roe")}
          <Kpi
            label="Préstamos / Depósitos"
            unit="pct"
            value={pdSeries[last] ?? null}
            prevMonth={idxPrevMonth >= 0 ? pdSeries[idxPrevMonth] : null}
            prevYear={idxPrevYear >= 0 ? pdSeries[idxPrevYear] : null}
          />
          {tasaCard("pases", "Tasa de pases entre terceros", ["r8", "Tasa implícita préstamos"])}
          {tasaCard("tamar", "Tasa TAMAR (TNA)", ["r9", "Tasa implícita depósitos"])}
        </div>
        {real && (
          <div className="note" style={{ marginTop: 10 }}>
            Montos expresados en pesos constantes de {periodLabel(latest, true)} (deflactados por IPC
            empalmado San Luis → CABA → INDEC). Los ratios no se deflactan.
          </div>
        )}
      </section>

      <section>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h3>Evolución histórica</h3>
              <div className="cs">Desde julio 2011 · {real ? "pesos constantes" : "valores publicados"}</div>
            </div>
            <div className="controls" style={{ marginBottom: 0 }}>
              <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                {Object.entries(index.metrics).map(([k, m]) => (
                  <option key={k} value={k}>{m.label}</option>
                ))}
              </select>
              <button className={`ctl ${showGroups ? "on" : ""}`} onClick={() => setShowGroups(!showGroups)}>
                Público / Privado
              </button>
            </div>
          </div>
          <TimeSeriesChart periods={periods} datasets={chartDatasets} unit={metricDef.unit} />
          {breakNote && <div className="note">{breakNote}</div>}
        </div>
      </section>

      {compMeta && (
        <section>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <h3>Composición del balance</h3>
                <div className="cs">
                  Rubros del balance resumido · {periodLabel(compMeta.period, true)}
                </div>
              </div>
              <Seg
                options={[
                  { value: "AA000", label: "Sistema" },
                  { value: "AA110", label: "Públicos" },
                  { value: "AA120", label: "Privados" },
                ]}
                value={compGroup}
                onChange={setCompGroup}
              />
            </div>
            <BalanceComposition meta={compMeta} />
          </div>
        </section>
      )}

      <section>
        <div className="grid2">
          <div className="card">
            <h3>Participación en el activo</h3>
            <div className="cs">{periodLabel(latest, true)}</div>
            <div className="chartbox sm">
              <Doughnut
                data={{
                  labels: shareData.labels,
                  datasets: [{ data: shareData.values, backgroundColor: [PALETTE[0], PALETTE[1], "#8a97b2"], borderWidth: 0 }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false, cutout: "58%",
                  plugins: {
                    legend: { position: "right", labels: { color: cc.txt } },
                    tooltip: { callbacks: { label: (c) => `${c.label}: ${num(c.raw as number, 1)}% del activo` } },
                  },
                }}
              />
            </div>
          </div>
          <div className="card">
            <h3>Público vs. privado — indicadores</h3>
            <div className="cs">Ratios ponderados calculados por el BCRA · {periodLabel(latest)}</div>
            <table>
              <thead>
                <tr>
                  <th className="n" style={{ fontWeight: 700 }}>Grupo</th><th style={{ fontWeight: 700 }}>Share activo</th><th style={{ fontWeight: 700 }}>ROE</th><th style={{ fontWeight: 700 }}>ROA</th><th style={{ fontWeight: 700 }}>Mora</th><th style={{ fontWeight: 700 }}>Liquidez</th>
                </tr>
              </thead>
              <tbody>
                {["AA000", "AA110", "AA120"].map((g) => {
                  const gs = system.groups[g];
                  if (!gs) return null;
                  const share = 100 * (gs.activo?.[last] ?? 0) / (system.groups.AA000?.activo?.[last] ?? 1);
                  const roe = gs.roe?.[last];
                  return (
                    <tr key={g}>
                      <td className="n">{g === "AA000" ? "SISTEMA" : GROUP_LABELS[g]}</td>
                      <td>{num(share, 1)}%</td>
                      <td className={(roe ?? 0) >= 0 ? "pos" : "neg"}>{pct(roe)}</td>
                      <td>{pct(gs.roa?.[last])}</td>
                      <td>{pct(gs.mora?.[last])}</td>
                      <td>{pct(gs.liquidez?.[last])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="cs" style={{ marginTop: 10 }}>
              Personal del sistema: <b style={{ color: "var(--txt)" }}>{fmtValue(aa000("personal")[last] ?? null, "cantidad")}</b> ·
              Entidades informadas: <b style={{ color: "var(--txt)" }}>{index.entities.filter((e) => e.last === latest).length}</b>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
