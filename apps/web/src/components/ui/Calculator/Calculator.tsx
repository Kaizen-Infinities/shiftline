import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  FaTimes,
  FaEquals,
  FaBackspace,
  FaCopy,
  FaCheck,
  FaHistory,
  FaCalculator,
} from "react-icons/fa";

interface CalculatorProps {
  onClose: () => void;
}

type CalcOp = "+" | "-" | "*" | "/" | null;

interface HistoryItem {
  expression: string;
  result: string;
  timestamp: string;
}

/** Draggable quick calculator with GST presets and history (Alt+C). */
const Calculator: React.FC<CalculatorProps> = ({ onClose }) => {
  const [display, setDisplay] = useState("0");
  const [prevValue, setPrevValue] = useState<number | null>(null);
  const [op, setOp] = useState<CalcOp>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [expression, setExpression] = useState("");
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeBtnKey, setActiveBtnKey] = useState<string | null>(null);

  // Dragging state
  const [pos, setPos] = useState({
    x: Math.max(20, Math.min(window.innerWidth - 410, window.innerWidth / 2 - 192)),
    y: Math.max(20, Math.min(window.innerHeight - 560, window.innerHeight / 2 - 270)),
  });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const flashBtn = (key: string) => {
    setActiveBtnKey(key);
    setTimeout(() => setActiveBtnKey(null), 150);
  };

  // ── Core calculation logic ─────────────────────────────────────
  const calculate = useCallback((a: number, operator: CalcOp, b: number): number => {
    switch (operator) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return b !== 0 ? a / b : 0;
      default:
        return b;
    }
  }, []);

  const handleDigit = useCallback(
    (digit: string) => {
      flashBtn(digit);
      if (waitingForOperand) {
        setDisplay(digit);
        setWaitingForOperand(false);
      } else {
        setDisplay((prev) => {
          if (prev === "0") return digit;
          if (prev.length >= 15) return prev;
          return prev + digit;
        });
      }
    },
    [waitingForOperand]
  );

  const handleDecimal = useCallback(() => {
    flashBtn(".");
    if (waitingForOperand) {
      setDisplay("0.");
      setWaitingForOperand(false);
      return;
    }
    if (!display.includes(".")) setDisplay((prev) => prev + ".");
  }, [waitingForOperand, display]);

  const handleOperator = useCallback(
    (nextOp: CalcOp) => {
      if (nextOp) flashBtn(nextOp);
      const curr = parseFloat(display);
      if (prevValue !== null && op && !waitingForOperand) {
        const result = calculate(prevValue, op, curr);
        const fmt = parseFloat(result.toPrecision(12)).toString();
        setDisplay(fmt);
        setExpression(
          `${fmt} ${nextOp === "*" ? "×" : nextOp === "/" ? "÷" : nextOp === "-" ? "−" : "+"}`
        );
        setPrevValue(result);
      } else {
        const opSym = nextOp === "*" ? "×" : nextOp === "/" ? "÷" : nextOp === "-" ? "−" : "+";
        setExpression(`${display} ${opSym}`);
        setPrevValue(curr);
      }
      setOp(nextOp);
      setWaitingForOperand(true);
    },
    [display, prevValue, op, waitingForOperand, calculate]
  );

  const handleEquals = useCallback(() => {
    flashBtn("=");
    if (prevValue === null || op === null) return;
    const curr = parseFloat(display);
    const result = calculate(prevValue, op, curr);
    const fmt = parseFloat(result.toPrecision(12)).toString();
    const fullExpr = `${expression} ${curr}`;

    // Add to calculation history
    setHistory((prev) => [
      {
        expression: fullExpr,
        result: fmt,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      },
      ...prev.slice(0, 19),
    ]);

    setExpression(`${fullExpr} =`);
    setDisplay(fmt);
    setPrevValue(null);
    setOp(null);
    setWaitingForOperand(true);
  }, [prevValue, op, display, expression, calculate]);

  const handleClear = useCallback(() => {
    flashBtn("C");
    setDisplay("0");
    setPrevValue(null);
    setOp(null);
    setWaitingForOperand(false);
    setExpression("");
  }, []);

  const handleBackspace = useCallback(() => {
    flashBtn("Backspace");
    if (waitingForOperand) return;
    setDisplay((prev) => (prev.length > 1 ? prev.slice(0, -1) : "0"));
  }, [waitingForOperand]);

  const handlePercent = useCallback(() => {
    flashBtn("%");
    const curr = parseFloat(display);
    if (prevValue !== null && op) {
      // e.g. 1000 + 18% = 1000 + (1000 * 0.18)
      const percentVal = (prevValue * curr) / 100;
      setDisplay(String(parseFloat(percentVal.toPrecision(12))));
    } else {
      setDisplay((prev) => String(parseFloat(prev) / 100));
    }
  }, [display, prevValue, op]);

  // Quick GST Calculation
  const handleQuickGST = useCallback(
    (rate: number) => {
      flashBtn(`GST${rate}`);
      const curr = parseFloat(display);
      if (isNaN(curr) || curr === 0) return;
      const gstAmount = (curr * rate) / 100;
      const total = curr + gstAmount;
      const fmt = parseFloat(total.toPrecision(12)).toString();
      setExpression(`${curr} + ${rate}% GST =`);

      setHistory((prev) => [
        {
          expression: `${curr} + ${rate}% GST (${gstAmount.toFixed(2)})`,
          result: fmt,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        },
        ...prev.slice(0, 19),
      ]);

      setDisplay(fmt);
      setPrevValue(null);
      setOp(null);
      setWaitingForOperand(true);
    },
    [display]
  );

  const handleToggleSign = useCallback(() => {
    flashBtn("+/-");
    setDisplay((prev) => String(parseFloat(prev) * -1));
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(display);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [display]);

  // ── Keyboard support ───────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        handleDigit(e.key);
        return;
      }
      if (e.key === ".") {
        e.preventDefault();
        handleDecimal();
        return;
      }
      if (e.key === "+" || e.key === "-" || e.key === "*" || e.key === "/") {
        e.preventDefault();
        handleOperator(e.key as CalcOp);
        return;
      }
      if (e.key === "Enter" || e.key === "=") {
        e.preventDefault();
        handleEquals();
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        handleBackspace();
        return;
      }
      if (e.key === "%") {
        e.preventDefault();
        handlePercent();
        return;
      }
      if (e.key === "Delete" || e.key === "c" || e.key === "C") {
        e.preventDefault();
        handleClear();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    handleDigit,
    handleDecimal,
    handleOperator,
    handleEquals,
    handleBackspace,
    handleClear,
    handlePercent,
    onClose,
  ]);

  // ── Drag handlers ──────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({
        x: Math.max(10, Math.min(e.clientX - dragOffset.current.x, window.innerWidth - 390)),
        y: Math.max(10, Math.min(e.clientY - dragOffset.current.y, window.innerHeight - 560)),
      });
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Format display numbers with locale commas (excluding trailing decimal typing)
  const formatDisplay = (numStr: string) => {
    if (!numStr) return "0";
    if (numStr === "Infinity" || numStr === "NaN") return numStr;
    const parts = numStr.split(".");
    const integerPart = parts[0];
    const decimalPart = parts[1];

    // Add commas to integer part
    const formattedInt = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return decimalPart !== undefined ? `${formattedInt}.${decimalPart}` : formattedInt;
  };

  const digitBtn =
    "py-3.5 rounded-[14px] text-base font-bold text-ink bg-card-2 hover:bg-card border border-line transition-colors active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const digitActive = (key: string) => (activeBtnKey === key ? "border-accent bg-accent/10" : "");
  const funcBtn =
    "py-3.5 rounded-[14px] text-sm font-bold text-ink-muted bg-card hover:bg-card-2 border border-line transition-colors active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex items-center justify-center";
  const funcActive = (key: string) => (activeBtnKey === key ? "border-accent text-accent" : "");
  const opBtn =
    "py-3.5 rounded-[14px] text-xl font-bold border transition-colors active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const opActive = (key: CalcOp) =>
    op === key || activeBtnKey === key
      ? "bg-accent text-white border-accent"
      : "border-line text-ink hover:border-accent/40 hover:text-accent";

  return (
    <div
      ref={panelRef}
      className="fixed z-[300] select-none"
      style={{ left: pos.x, top: pos.y, width: 380 }}
    >
      {/* Outer shell — bordered sheet, not a floating glass card */}
      <div className="sl-dialog overflow-hidden flex flex-col">
        {/* ── 1. HEADER / DRAGGABLE TITLE BAR ── */}
        <div
          className="flex items-center justify-between px-3.5 py-2.5 bg-card-2 border-b border-line-soft cursor-grab active:cursor-grabbing"
          onMouseDown={onMouseDown}
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-[14px] border border-accent/40 text-accent flex items-center justify-center text-xs">
              <FaCalculator />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[12px] font-bold tracking-wide text-ink uppercase flex items-center gap-1.5">
                Quick Calculator
              </span>
              <span className="text-[9px] font-semibold text-ink-subtle font-mono">Alt+C</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* History Toggle */}
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              title="Calculation History"
              aria-label="Calculation history"
              aria-pressed={showHistory}
              className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                showHistory
                  ? "border-accent text-accent bg-accent/10"
                  : "border-line text-ink-muted hover:text-ink hover:bg-card-2"
              }`}
            >
              <FaHistory className="text-[10px]" />
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close calculator"
              className="w-8 h-8 rounded-full border border-line text-ink-muted hover:text-ink hover:bg-card-2 flex items-center justify-center text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <FaTimes className="text-[11px]" />
            </button>
          </div>
        </div>

        {/* ── 2. CALCULATION HISTORY DRAWER (Collapsible) ── */}
        {showHistory && (
          <div className="bg-card-2 border-b border-line p-2.5 max-h-40 overflow-y-auto">
            <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-line-soft text-[10px] text-ink-muted font-bold uppercase tracking-wider">
              <span>Recent Calculations</span>
              {history.length > 0 && (
                <button
                  onClick={() => setHistory([])}
                  className="text-[color:var(--color-danger)] hover:underline font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[14px]"
                >
                  Clear
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="text-[11px] text-ink-subtle text-center py-3">No history yet</p>
            ) : (
              <div className="space-y-1.5">
                {history.map((h, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      setDisplay(h.result);
                      setWaitingForOperand(true);
                    }}
                    className="p-1.5 rounded-[14px] bg-card hover:border-accent/40 hover:bg-card-2 border border-line-soft transition-colors cursor-pointer group text-right"
                  >
                    <div className="text-[10px] text-ink-subtle font-mono truncate group-hover:text-ink-muted">
                      {h.expression}
                    </div>
                    <div className="text-xs font-bold text-ink font-mono tabular-nums group-hover:text-accent">
                      {h.result}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 3. DIGITAL DISPLAY SCREEN ── */}
        <div className="px-5 py-4 bg-card-2 border-b border-line relative group">
          {/* Top Expression Row */}
          <div className="flex items-center justify-between text-xs font-mono h-5 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted border border-line-soft px-1.5 py-0.5 rounded-[14px]">
              {op ? `OP: ${op === "*" ? "×" : op === "/" ? "÷" : op === "-" ? "−" : "+"}` : "READY"}
            </span>
            <span className="truncate max-w-[260px] text-right text-ink-muted font-semibold">
              {expression || " "}
            </span>
          </div>

          {/* Main Large Digits */}
          <div className="flex items-end justify-between gap-3 pt-1">
            {/* Quick Copy Button */}
            <button
              type="button"
              onClick={handleCopy}
              title="Copy Result"
              aria-label="Copy result"
              className={`p-2 rounded-[14px] border transition-colors cursor-pointer shrink-0 mb-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                copied
                  ? "border-accent text-accent bg-accent/10"
                  : "border-line text-ink-muted hover:text-accent hover:border-accent/40"
              }`}
            >
              {copied ? <FaCheck className="text-xs" /> : <FaCopy className="text-xs" />}
            </button>

            {/* Formatted Number Display */}
            <div
              className="text-4xl font-bold font-mono tabular-nums text-right tracking-tight text-ink truncate leading-none flex-1"
              title={display}
            >
              {formatDisplay(display)}
            </div>
          </div>
        </div>

        {/* ── 4. QUICK GST PRESET BUTTONS (SUPER USEFUL FOR ERP) ── */}
        <div className="grid grid-cols-4 gap-1.5 px-4 pt-2.5 pb-2 bg-card border-b border-line">
          {[5, 12, 18, 28].map((gst) => (
            <button
              key={gst}
              type="button"
              onClick={() => handleQuickGST(gst)}
              className={`py-1.5 rounded-[14px] text-[11px] font-bold tracking-wide border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                activeBtnKey === `GST${gst}`
                  ? "bg-accent text-white border-accent"
                  : "border-line text-ink-muted hover:text-accent hover:border-accent/40 hover:bg-card-2"
              }`}
            >
              +{gst}% GST
            </button>
          ))}
        </div>

        {/* ── 5. KEYPAD GRID ── */}
        <div className="grid grid-cols-4 gap-2.5 p-4 bg-card">
          {/* Row 1: AC, +/-, %, ÷ */}
          <button type="button" onClick={handleClear} className={`${funcBtn} ${funcActive("C")}`}>
            AC
          </button>
          <button
            type="button"
            onClick={handleToggleSign}
            className={`${funcBtn} ${funcActive("+/-")}`}
          >
            ±
          </button>
          <button type="button" onClick={handlePercent} className={`${funcBtn} ${funcActive("%")}`}>
            %
          </button>
          <button
            type="button"
            onClick={() => handleOperator("/")}
            className={`${opBtn} ${opActive("/")}`}
          >
            ÷
          </button>

          {/* Row 2: 7, 8, 9, × */}
          <button
            type="button"
            onClick={() => handleDigit("7")}
            className={`${digitBtn} ${digitActive("7")}`}
          >
            7
          </button>
          <button
            type="button"
            onClick={() => handleDigit("8")}
            className={`${digitBtn} ${digitActive("8")}`}
          >
            8
          </button>
          <button
            type="button"
            onClick={() => handleDigit("9")}
            className={`${digitBtn} ${digitActive("9")}`}
          >
            9
          </button>
          <button
            type="button"
            onClick={() => handleOperator("*")}
            className={`${opBtn} ${opActive("*")}`}
          >
            ×
          </button>

          {/* Row 3: 4, 5, 6, − */}
          <button
            type="button"
            onClick={() => handleDigit("4")}
            className={`${digitBtn} ${digitActive("4")}`}
          >
            4
          </button>
          <button
            type="button"
            onClick={() => handleDigit("5")}
            className={`${digitBtn} ${digitActive("5")}`}
          >
            5
          </button>
          <button
            type="button"
            onClick={() => handleDigit("6")}
            className={`${digitBtn} ${digitActive("6")}`}
          >
            6
          </button>
          <button
            type="button"
            onClick={() => handleOperator("-")}
            className={`${opBtn} ${opActive("-")}`}
          >
            −
          </button>

          {/* Row 4: 1, 2, 3, + */}
          <button
            type="button"
            onClick={() => handleDigit("1")}
            className={`${digitBtn} ${digitActive("1")}`}
          >
            1
          </button>
          <button
            type="button"
            onClick={() => handleDigit("2")}
            className={`${digitBtn} ${digitActive("2")}`}
          >
            2
          </button>
          <button
            type="button"
            onClick={() => handleDigit("3")}
            className={`${digitBtn} ${digitActive("3")}`}
          >
            3
          </button>
          <button
            type="button"
            onClick={() => handleOperator("+")}
            className={`${opBtn} ${opActive("+")}`}
          >
            +
          </button>

          {/* Row 5: Backspace, 0, ., = */}
          <button
            type="button"
            onClick={handleBackspace}
            title="Backspace"
            aria-label="Backspace"
            className={`${funcBtn} ${funcActive("Backspace")}`}
          >
            <FaBackspace className="text-base" />
          </button>

          <button
            type="button"
            onClick={() => handleDigit("0")}
            className={`${digitBtn} ${digitActive("0")}`}
          >
            0
          </button>

          <button
            type="button"
            onClick={handleDecimal}
            className={`${digitBtn} ${digitActive(".")}`}
          >
            .
          </button>

          <button
            type="button"
            onClick={handleEquals}
            aria-label="Equals"
            className={`sl-cta !px-0 py-3.5 text-sm ${
              activeBtnKey === "=" ? "ring-2 ring-accent/40" : ""
            }`}
          >
            <FaEquals className="text-sm" />
          </button>
        </div>

        {/* ── 6. FOOTER HINT ── */}
        <div className="px-3.5 py-2 bg-card-2 border-t border-line flex items-center justify-between text-[9.5px] text-ink-subtle font-mono">
          <span>Esc close · Enter for result</span>
          <span>Drag header to move</span>
        </div>
      </div>
    </div>
  );
};

export default Calculator;
