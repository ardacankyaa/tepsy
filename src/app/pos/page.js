"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "@/lib/socket-client";
import soundEngine from "@/lib/sound.mjs";
import ReceiptModal from "@/components/ReceiptModal";
import { useApp } from "@/lib/AppContext";
import { createPaymentRequest } from "@/lib/pos-payment-request.cjs";
import {
  clearOrderAttempt,
  isDefinitiveOrderRejection,
  restoreOrderAttempt,
  restoreOrCreateOrderAttempt,
} from "@/lib/order-idempotency.mjs";
import PosCommandBar from "@/components/pos/PosCommandBar";
import PosTableSelector from "@/components/pos/PosTableSelector";
import PosCheckoutPanel from "@/components/pos/PosCheckoutPanel";
import PosPaymentHistory from "@/components/pos/PosPaymentHistory";
import MenuPhoto from "@/components/ui/MenuPhoto";
import { Dialog, PageControls, usePages } from "@/components/ui/Workspace";
import "@/styles/operations.css";
import { Plus, Search } from "lucide-react";

const MENU_PAGE_SIZE = 8;

export default function PosPage() {
  const { socket } = useSocket();
  const { t, formatPrice, lang } = useApp();
  const [tables, setTables] = useState([]);
  const [floorElements, setFloorElements] = useState([]);
  const [floorCanvases, setFloorCanvases] = useState({});
  const [selectedSection, setSelectedSection] = useState("");
  const [selectedTable, setSelectedTable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tablesError, setTablesError] = useState("");

  const [menuItems, setMenuItems] = useState([]);
  const [showAddMenuModal, setShowAddMenuModal] = useState(false);
  const [addMenuSearch, setAddMenuSearch] = useState("");
  const [menuError, setMenuError] = useState("");
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [itemActionError, setItemActionError] = useState("");
  const [posOrderAttempt, setPosOrderAttempt] = useState(null);
  const [posOrderAttemptReady, setPosOrderAttemptReady] = useState(true);
  const posOrderAttemptRef = useRef(null);
  const [cancelItemPending, setCancelItemPending] = useState(null);

  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountReason, setDiscountReason] = useState("POS yüzde indirimi");
  const [partialAmount, setPartialAmount] = useState("");
  const [selectedItems, setSelectedItems] = useState([]);
  const [tipAmount, setTipAmount] = useState("");
  const tipEditedRef = useRef(false);
  const paymentAttemptRef = useRef(null);
  const [currentShift, setCurrentShift] = useState(null);
  const [shiftPanelOpen, setShiftPanelOpen] = useState(false);
  const [shiftCash, setShiftCash] = useState("");
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftError, setShiftError] = useState("");
  const [closedShiftSummary, setClosedShiftSummary] = useState(null);

  const [receiptData, setReceiptData] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTableId, setHistoryTableId] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [paymentAccount, setPaymentAccount] = useState(null);
  const [latestPayment, setLatestPayment] = useState(null);
  const [receiptError, setReceiptError] = useState("");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const paymentBusyRef = useRef(false);
  const [manualCardPending, setManualCardPending] = useState(null);
  const [mobilePane, setMobilePane] = useState("tables");
  const [tableView, setTableView] = useState("floorplan");

  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const fetchRequestRef = useRef(0);
  const shiftRequestRef = useRef(0);
  const receivePaymentAccount = useCallback(
    (next) => {
      setPaymentAccount(next);
      if (
        !tipEditedRef.current &&
        next.tableId === selectedTable?.id &&
        next.summary?.remainingTipAmount !== undefined
      )
        setTipAmount(String(next.summary.remainingTipAmount));
    },
    [selectedTable?.id]
  );

  useEffect(() => {
    const tableId = selectedTable?.id;
    if (!tableId) {
      posOrderAttemptRef.current = null;
      setPosOrderAttempt(null);
      setPosOrderAttemptReady(true);
      return;
    }
    setPosOrderAttemptReady(false);
    const attempt = restoreOrderAttempt(`tepsy:order-attempt:pos:${tableId}`, "tableId", tableId);
    posOrderAttemptRef.current = attempt;
    setPosOrderAttempt(attempt);
    setPosOrderAttemptReady(true);
  }, [selectedTable?.id]);

  const fetchTables = useCallback(async () => {
    const requestId = ++fetchRequestRef.current;
    try {
      const [tableResponse, menuResponse, floorResponse, canvasResponse] = await Promise.all([
        fetch("/api/tables", { cache: "no-store" }),
        fetch("/api/menu-items?availableOnly=true", { cache: "no-store" }),
        fetch("/api/floor-elements", { cache: "no-store" }),
        fetch("/api/floor-plan/canvas", { cache: "no-store" }).catch(() => null),
      ]);

      if (requestId !== fetchRequestRef.current) return;
      if (!tableResponse.ok) throw new Error("tables-unavailable");
      const tableData = await tableResponse.json();
      if (!Array.isArray(tableData)) throw new Error("tables-invalid-response");
      if (requestId !== fetchRequestRef.current) return;

      setTables(tableData);
      setHistoryRevision((value) => value + 1);
      const nextSections = Array.from(
        new Set(tableData.map((table) => table.section).filter(Boolean))
      );
      setSelectedSection((current) =>
        nextSections.includes(current) ? current : nextSections[0] || ""
      );
      setSelectedTable((current) =>
        current ? tableData.find((table) => table.id === current.id) || null : null
      );
      setTablesError("");

      if (menuResponse.ok) {
        const data = await menuResponse.json();
        if (requestId === fetchRequestRef.current) {
          setMenuItems(Array.isArray(data) ? data : []);
          setMenuError("");
        }
      } else {
        setMenuError(
          lang === "en" ? "Menu items could not be loaded." : "Menü ürünleri yüklenemedi."
        );
      }
      if (floorResponse.ok) {
        const elements = await floorResponse.json();
        if (requestId === fetchRequestRef.current)
          setFloorElements(Array.isArray(elements) ? elements : []);
      }
      if (canvasResponse?.ok) {
        try {
          const canvases = await canvasResponse.json();
          if (requestId === fetchRequestRef.current && Array.isArray(canvases)) {
            setFloorCanvases(
              Object.fromEntries(canvases.map((canvas) => [canvas.section, canvas]))
            );
          }
        } catch (error) {
          console.warn("Kroki boyutları alınamadı:", error);
        }
      }
    } catch (error) {
      if (requestId !== fetchRequestRef.current) return;
      console.error("Kasa verisi alınamadı:", error);
      setTablesError(
        lang === "en"
          ? "Table information could not be loaded. Check the connection and try again."
          : "Masa bilgileri yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin."
      );
    } finally {
      if (requestId === fetchRequestRef.current) setLoading(false);
    }
  }, [lang]);

  const fetchShift = useCallback(async () => {
    const requestId = ++shiftRequestRef.current;
    try {
      const response = await fetch("/api/pos/shift", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      if (requestId === shiftRequestRef.current) setCurrentShift(payload.currentShift || null);
    } catch (error) {
      console.error("Vardiya bilgisi alınamadı:", error);
    }
  }, []);

  useEffect(() => {
    fetchTables();
    fetchShift();
    return () => {
      fetchRequestRef.current += 1;
      shiftRequestRef.current += 1;
    };
  }, [fetchTables, fetchShift]);

  const submitShift = async () => {
    setShiftBusy(true);
    setShiftError("");
    try {
      const method = currentShift ? "PATCH" : "POST";
      const body = currentShift
        ? { shiftId: currentShift.id, closingCash: shiftCash }
        : { openingCash: shiftCash };
      const response = await fetch("/api/pos/shift", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409) await fetchShift();
      if (!response.ok)
        throw new Error(
          payload.error || (lang === "en" ? "Shift could not be saved." : "Vardiya kaydedilemedi.")
        );
      if (method === "PATCH") setClosedShiftSummary(payload);
      setShiftPanelOpen(false);
      setShiftCash("");
      await fetchShift();
    } catch (error) {
      setShiftError(
        error.message || (lang === "en" ? "Shift could not be saved." : "Vardiya kaydedilemedi.")
      );
    } finally {
      setShiftBusy(false);
    }
  };

  useEffect(() => {
    if (!socket) return;
    const handleTableUpdate = () => fetchTables();
    const handleConnect = () => {
      fetchTables();
      fetchShift();
    };
    const handleCanvasUpdate = (canvas) => {
      if (!canvas?.section) return;
      setFloorCanvases((current) => ({ ...current, [canvas.section]: canvas }));
    };
    const handleBillRequested = () => {
      fetchTables();
      soundEngine.playBillRequested();
    };
    const handleNewOrder = () => {
      fetchTables();
      soundEngine.playNewOrder();
    };

    socket.on("connect", handleConnect);
    socket.on("cash-shift:opened", fetchShift);
    socket.on("cash-shift:closed", fetchShift);
    socket.on("table:update", handleTableUpdate);
    socket.on("table:layout_update", handleTableUpdate);
    socket.on("table:bill_requested", handleBillRequested);
    socket.on("order:new", handleNewOrder);
    socket.on("order:update", handleTableUpdate);
    socket.on("payment:completed", handleTableUpdate);
    socket.on("floor-elements:update", handleTableUpdate);
    socket.on("floorplan:canvas_update", handleCanvasUpdate);
    return () => {
      socket.off("connect", handleConnect);
      socket.off("cash-shift:opened", fetchShift);
      socket.off("cash-shift:closed", fetchShift);
      socket.off("table:update", handleTableUpdate);
      socket.off("table:layout_update", handleTableUpdate);
      socket.off("table:bill_requested", handleBillRequested);
      socket.off("order:new", handleNewOrder);
      socket.off("order:update", handleTableUpdate);
      socket.off("payment:completed", handleTableUpdate);
      socket.off("floor-elements:update", handleTableUpdate);
      socket.off("floorplan:canvas_update", handleCanvasUpdate);
    };
  }, [socket, fetchTables, fetchShift]);

  const sections = Array.from(new Set(tables.map((table) => table.section).filter(Boolean)));
  const activeOrders = selectedTable?.orders || [];
  const allOrderItems = activeOrders.flatMap((order) => order.items || []);
  const accountOrderIds = activeOrders
    .map((order) => order.id)
    .sort()
    .join(",");
  const accountSummary =
    paymentAccount?.tableId === selectedTable?.id && paymentAccount?.orderIds === accountOrderIds
      ? paymentAccount.summary
      : null;
  const activeGrossCents = activeOrders.reduce(
    (sum, order) => sum + Math.round(Number(order.totalPrice) * 100),
    0
  );
  const activePaidCents = activeOrders.reduce(
    (sum, order) =>
      sum +
      (order.payments || []).reduce(
        (paid, payment) => paid + Math.round(Number(payment.amountPaid) * 100),
        0
      ),
    0
  );
  const activeDiscountCents = activeOrders.reduce(
    (sum, order) => sum + Math.round(Number(order.discountAmount || 0) * 100),
    0
  );
  const grossCents = accountSummary
    ? Math.round(Number(accountSummary.grossTotal) * 100)
    : activeGrossCents;
  const paidCents = accountSummary
    ? Math.round(Number(accountSummary.totalPaid) * 100)
    : activePaidCents;
  const existingDiscountCents = accountSummary
    ? Math.round(Number(accountSummary.discountAmount) * 100)
    : activeDiscountCents;
  const requestedDiscountCents = Math.round((grossCents * discountPercent) / 100);
  const rawSubtotal = grossCents / 100;
  const finalTotalAmount = Math.max(
    0,
    (grossCents - Math.max(existingDiscountCents, requestedDiscountCents) - paidCents) / 100
  );

  const selectTable = (table) => {
    setSelectedTable(table);
    setSelectedItems([]);
    tipEditedRef.current = false;
    setTipAmount("");
    setDiscountPercent(Number(table.orders?.[0]?.discountPercent || 0));
    setDiscountReason(
      table.orders?.[0]?.discountReason || (lang === "en" ? "POS discount" : "POS yüzde indirimi")
    );
    setPartialAmount("");
    setMobilePane("account");
    setPaymentError("");
    setItemActionError("");
  };
  const returnToTables = () => {
    setMobilePane("tables");
    setTableView("list");
  };
  const clearSelectedTable = () => {
    setSelectedTable(null);
    setMobilePane("tables");
  };

  const savePayment = async (paymentPayload, paymentContext) => {
    if (paymentBusyRef.current) return;
    paymentBusyRef.current = true;
    setIsProcessingPayment(true);
    setPaymentError("");
    try {
      const response = await fetch("/api/pos/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paymentPayload),
      });

      if (response.status === 409) {
        const challenge = await response
          .clone()
          .json()
          .catch(() => null);
        if (
          challenge?.code === "manual-card-confirmation-required" &&
          !paymentPayload.manualCardConfirmed
        ) {
          if (challenge.terminalBasketTransferRequired) {
            const transferResponse = await fetch("/api/pos/terminal", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(paymentPayload),
            });
            const transfer = await transferResponse.json().catch(() => ({}));
            if (!transferResponse.ok || transfer.accepted !== true)
              throw new Error(
                transfer.error ||
                  (lang === "en"
                    ? "The bill could not be sent to the terminal."
                    : "Adisyon POS cihazına aktarılamadı.")
              );
          }
          setManualCardPending({ payload: paymentPayload, context: paymentContext });
          return;
        }
      }
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(
          result?.error ||
            (lang === "en" ? "Payment could not be recorded." : "Ödeme kaydedilemedi.")
        );
      }

      const settled = await response.json();
      soundEngine.playCash();
      const receipt = settled.receipt || {
        id: settled.payments?.[0]?.id || paymentPayload.idempotencyKey,
        kind: "PAYMENT",
        tableId: paymentContext.table.id,
        tableNumber: paymentContext.table.tableNumber,
        section: paymentContext.table.section,
        orderId: paymentContext.orders[0]?.id || "TX",
        items: paymentContext.items,
        totalAmount: Number(settled.amountPaid),
        grossTotal: settled.grossTotal,
        discountAmount: settled.discountAmount,
        netTotal: settled.netTotal,
        amountPaid: settled.amountPaid,
        remainingBalance: settled.remainingBalance,
        paymentMethod: paymentContext.paymentMethod,
        cardVerification: settled.cardVerification,
        timestamp: settled.timestamp || new Date(),
      };
      setReceiptData(receipt);
      setShowReceipt(true);
      paymentAttemptRef.current = null;
      setPartialAmount("");
      setSelectedItems([]);
      setTipAmount("0");
      tipEditedRef.current = true;
      if (Number(settled.remainingBalance) === 0) {
        setSelectedTable(null);
        setMobilePane("tables");
        setDiscountPercent(0);
      }
      await fetchTables();
      await fetchShift();
      setLatestPayment(receipt);
    } catch (error) {
      console.error("Ödeme hatası:", error);
      const message =
        error instanceof TypeError
          ? lang === "en"
            ? "The payment result could not be confirmed. The table has been refreshed. Check the account status before starting another payment."
            : "Ödeme sonucu doğrulanamadı. Masa bilgisi yenilendi. Yeni tahsilat başlatmadan önce hesap durumunu kontrol edin."
          : error.message ||
            (lang === "en" ? "Payment could not be recorded." : "Ödeme kaydedilemedi.");
      setPaymentError(message);
      await fetchTables();
      await fetchShift();
    } finally {
      paymentBusyRef.current = false;
      setIsProcessingPayment(false);
    }
  };

  const handlePayment = async (paymentMethod) => {
    if (!selectedTable || activeOrders.length === 0 || isProcessingPayment) return;
    if (!currentShift) {
      setPaymentError(
        lang === "en"
          ? "Open a cash shift before taking payment."
          : "Tahsilattan önce kasa vardiyası açın."
      );
      setShiftPanelOpen(true);
      return;
    }

    const tableToPay = selectedTable;
    const ordersToPay = activeOrders;
    const itemsToPay = allOrderItems;
    const attemptFingerprint = [
      tableToPay.id,
      paymentMethod,
      discountPercent,
      discountReason,
      partialAmount,
      JSON.stringify(selectedItems),
      tipAmount,
    ].join("|");
    if (paymentAttemptRef.current?.fingerprint !== attemptFingerprint) {
      paymentAttemptRef.current = {
        fingerprint: attemptFingerprint,
        key: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      };
    }
    const payload = createPaymentRequest({
      tableId: tableToPay.id,
      paymentMethod,
      discountPercent,
      discountReason,
      partialAmount,
      selectedItems,
      tipAmount,
      idempotencyKey: paymentAttemptRef.current.key,
    });
    if (!payload) {
      setPaymentError(
        lang === "en"
          ? "Check the discount, item selection, partial amount and tip."
          : "İndirim, ürün seçimi, kısmi ödeme ve bahşiş tutarını kontrol edin."
      );
      return;
    }
    setPaymentError("");
    await savePayment(payload, {
      table: tableToPay,
      orders: ordersToPay,
      items: itemsToPay,
      paymentMethod,
    });
  };

  const confirmManualCard = async () => {
    if (!manualCardPending) return;
    const pending = manualCardPending;
    setManualCardPending(null);
    await savePayment({ ...pending.payload, manualCardConfirmed: true }, pending.context);
  };

  const retryPendingPosOrder = async () => {
    const tableAtRetry = selectedTable;
    const attempt = posOrderAttemptRef.current;
    if (!tableAtRetry || !attempt || isAddingItem || !posOrderAttemptReady) return;
    setIsAddingItem(true);
    setItemActionError("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: attempt.body,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        if (isDefinitiveOrderRejection(response.status)) {
          clearOrderAttempt(`tepsy:order-attempt:pos:${tableAtRetry.id}`);
          posOrderAttemptRef.current = null;
          setPosOrderAttempt(null);
        }
        throw new Error(
          result?.error ||
            (lang === "en"
              ? "Item could not be added to the account."
              : "Ürün adisyona eklenemedi.")
        );
      }
      clearOrderAttempt(`tepsy:order-attempt:pos:${tableAtRetry.id}`);
      posOrderAttemptRef.current = null;
      setPosOrderAttempt(null);
      await fetchTables();
    } catch (error) {
      console.error("POS order retry could not be confirmed:", error);
      await fetchTables();
      setItemActionError(
        posOrderAttemptRef.current
          ? lang === "en"
            ? "The order result is still uncertain. Retry this same item before adding anything else."
            : "Sipariş sonucu hâlâ doğrulanamadı. Başka ürün eklemeden önce aynı isteği yeniden deneyin."
          : error.message ||
              (lang === "en" ? "Item could not be added." : "Ürün adisyona eklenemedi.")
      );
    } finally {
      setIsAddingItem(false);
    }
  };

  const handleAddItemToTable = async (menuItem) => {
    if (!selectedTable || isAddingItem || !posOrderAttemptReady) return;
    if (posOrderAttemptRef.current) {
      setShowAddMenuModal(false);
      await retryPendingPosOrder();
      return;
    }
    const tableAtAdd = selectedTable;
    const attempt = restoreOrCreateOrderAttempt(
      `tepsy:order-attempt:pos:${tableAtAdd.id}`,
      { tableId: tableAtAdd.id, items: [{ menuItemId: menuItem.id, quantity: 1 }] },
      "tableId",
      tableAtAdd.id
    );
    if (!attempt) {
      setItemActionError(
        lang === "en"
          ? "The browser could not save a safe retry. Enable session storage and try again."
          : "Tarayıcı güvenli yeniden deneme bilgisini kaydedemedi. Depolamayı etkinleştirin."
      );
      return;
    }
    posOrderAttemptRef.current = attempt;
    setPosOrderAttempt(attempt);
    setShowAddMenuModal(false);
    await retryPendingPosOrder();
  };

  const handleCancelItem = (orderId, itemId) => {
    const item = allOrderItems.find(
      (candidate) => candidate.id === itemId && candidate.orderId === orderId
    );
    setCancelItemPending({
      orderId,
      itemId,
      name: item?.menuItemName || item?.menuItem?.name || (lang === "en" ? "this item" : "bu ürün"),
    });
  };

  const confirmCancelItem = async () => {
    if (!cancelItemPending || !selectedTable) return;
    const pending = cancelItemPending;
    setCancelItemPending(null);
    setItemActionError("");
    const previousTable = selectedTable;
    setSelectedTable((current) =>
      current
        ? {
            ...current,
            orders: current.orders?.map((order) => ({
              ...order,
              items: order.items?.filter((item) => item.id !== pending.itemId),
            })),
          }
        : current
    );
    try {
      const response = await fetch(`/api/orders/${pending.orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelItemId: pending.itemId }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(
          result?.error || (lang === "en" ? "Item could not be removed." : "Ürün kaldırılamadı.")
        );
      }
      await fetchTables();
    } catch (error) {
      console.error("Ürün iptal edilemedi:", error);
      setSelectedTable(previousTable);
      setItemActionError(
        error instanceof TypeError
          ? lang === "en"
            ? "The removal result could not be confirmed. The table was refreshed; check the account before retrying."
            : "Ürün kaldırma sonucu doğrulanamadı. Masa yenilendi; yeniden denemeden önce hesabı kontrol edin."
          : error.message || (lang === "en" ? "Item could not be removed." : "Ürün kaldırılamadı.")
      );
      await fetchTables();
    }
  };

  const previewReceipt = () => {
    if (!selectedTable || activeOrders.length === 0) return;
    setReceiptData({
      kind: "BILL",
      tableNumber: selectedTable.tableNumber,
      section: selectedTable.section,
      orderId: activeOrders[0]?.id || "TX",
      items: allOrderItems,
      totalAmount: finalTotalAmount,
      paymentMethod: "CASH",
      timestamp: new Date(),
    });
    setShowReceipt(true);
  };

  const openStoredReceipt = async (id) => {
    if (receiptLoading) return;
    setReceiptLoading(true);
    setReceiptError("");
    try {
      const response = await fetch(`/api/pos/payments/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.receipt)
        throw new Error(
          payload.error || (lang === "tr" ? "Fiş alınamadı." : "Receipt could not be loaded.")
        );
      setReceiptData(payload.receipt);
      setHistoryOpen(false);
      setShowReceipt(true);
    } catch (error) {
      setReceiptError(
        error.message || (lang === "tr" ? "Fiş alınamadı." : "Receipt could not be loaded.")
      );
    } finally {
      setReceiptLoading(false);
    }
  };

  const occupiedCount = tables.filter(
    (table) => table.status === "OCCUPIED" || table.status === "BILL_REQUESTED"
  ).length;
  const billReqCount = tables.filter((table) => table.status === "BILL_REQUESTED").length;
  const filteredMenuItems = menuItems.filter((item) =>
    String(item.name || "")
      .toLocaleLowerCase(lang === "tr" ? "tr-TR" : "en-US")
      .includes(addMenuSearch.trim().toLocaleLowerCase(lang === "tr" ? "tr-TR" : "en-US"))
  );
  const menuPages = usePages(filteredMenuItems, MENU_PAGE_SIZE);
  const setMenuPage = menuPages.setPage;

  useEffect(() => {
    setMenuPage(1);
  }, [addMenuSearch, showAddMenuModal, setMenuPage]);

  const labels =
    lang === "en"
      ? {
          tableTab: "Tables",
          accountTab: "Account and payment",
          menuTitle: "Add a menu item",
          menuSearch: "Search menu items",
          noMenu: "No menu items match this search.",
          menuLoadError: "Menu items are unavailable.",
          add: "Add",
          shiftOpenTitle: "Open cash shift",
          shiftCloseTitle: "Close cash shift",
          openingCash: "Opening cash",
          countedCash: "Counted cash",
          openingText: "Enter the starting cash before taking payments.",
          closingText:
            "Count the cash in the drawer. The closing record will preserve the payment snapshot and variance.",
          saveShift: "Open shift",
          closeShift: "Close shift",
          saving: "Saving…",
          closedTitle: "Shift closed",
          openDialog: "Open shift",
          cancelTitle: "Remove item from account?",
          cancelText: (name) =>
            `Remove ${name} from this account? The server will confirm whether the order can still be changed.`,
          cancelAction: "Remove item",
          keepItem: "Keep item",
          manualTitle: "Confirm manual card payment",
          manualText:
            "Have you already collected this payment on an external card terminal? TEPSY will only record the payment manually. It will not charge the card. Cancel if the terminal payment has not been collected.",
          manualConfirm: "I collected payment on the external terminal",
          manualCancel: "Cancel",
        }
      : {
          tableTab: "Masalar",
          accountTab: "Hesap ve tahsilat",
          menuTitle: "Menüden ürün ekle",
          menuSearch: "Menüde ürün ara",
          noMenu: "Bu aramayla eşleşen ürün yok.",
          menuLoadError: "Menü ürünleri kullanılamıyor.",
          add: "Ekle",
          shiftOpenTitle: "Kasa vardiyasını aç",
          shiftCloseTitle: "Kasa vardiyasını kapat",
          openingCash: "Açılış nakdi",
          countedCash: "Sayılan nakit",
          openingText: "Tahsilat almadan önce başlangıç nakdini girin.",
          closingText:
            "Kasadaki nakdi sayın. Kapanış kaydı tahsilat özetini ve sayım farkını saklar.",
          saveShift: "Vardiyayı aç",
          closeShift: "Vardiyayı kapat",
          saving: "Kaydediliyor…",
          closedTitle: "Vardiya kapandı",
          openDialog: "Vardiyayı aç",
          cancelTitle: "Ürün adisyondan kaldırılsın mı?",
          cancelText: (name) =>
            `${name} bu hesaptan kaldırılsın mı? Siparişin hâlâ değiştirilebilir olduğunu sunucu doğrular.`,
          cancelAction: "Ürünü kaldır",
          keepItem: "Ürünü koru",
          manualTitle: "Manuel kart kaydını onayla",
          manualText:
            "Bu tahsilatı harici kart terminalinde aldınız mı? TEPSY yalnızca ödeme kaydı oluşturur; karttan para çekmez. Terminal tahsilatı yapılmadıysa vazgeçin.",
          manualConfirm: "Harici terminalde tahsil ettim",
          manualCancel: "Vazgeç",
        };

  const menuPageLabel = lang === "en" ? "Menu item pages" : "Menü ürünü sayfaları";
  const showAddMenu = (open) => {
    setMenuError("");
    setAddMenuSearch("");
    setShowAddMenuModal(open);
  };

  return (
    <div className="operations-pos">
      <PosCommandBar
        lang={lang}
        t={t}
        sections={sections}
        selectedSection={selectedSection}
        setSelectedSection={setSelectedSection}
        setShiftError={setShiftError}
        setShiftPanelOpen={setShiftPanelOpen}
        currentShift={currentShift}
        occupiedCount={occupiedCount}
        tables={tables}
        billReqCount={billReqCount}
        onHistory={() => {
          setReceiptError("");
          setHistoryTableId("");
          setHistoryOpen(true);
        }}
      />

      <nav
        className="pos-mobile-switch"
        aria-label={lang === "en" ? "Cashier panels" : "Kasa panelleri"}
      >
        <button
          type="button"
          aria-pressed={mobilePane === "tables"}
          className={mobilePane === "tables" ? "is-selected" : ""}
          onClick={() => setMobilePane("tables")}
        >
          {labels.tableTab}
        </button>
        <button
          type="button"
          aria-pressed={mobilePane === "account"}
          disabled={!selectedTable}
          className={mobilePane === "account" ? "is-selected" : ""}
          onClick={() => setMobilePane("account")}
        >
          {labels.accountTab}
          {selectedTable && <span>{selectedTable.tableNumber}</span>}
        </button>
      </nav>

      <div className="pos-main" data-mobile-pane={mobilePane}>
        <PosTableSelector
          lang={lang}
          tables={tables}
          selectedSection={selectedSection}
          selectedTable={selectedTable}
          setSelectedTable={setSelectedTable}
          floorElements={floorElements}
          floorCanvases={floorCanvases}
          tableView={tableView}
          onTableViewChange={setTableView}
          loading={loading}
          error={tablesError}
          mobileActive={mobilePane === "tables"}
          onSelect={selectTable}
        />

        <PosCheckoutPanel
          key={selectedTable?.id || "no-table"}
          checkout={{
            table: selectedTable,
            activeOrders,
            items: allOrderItems,
            paymentError,
            itemActionError,
            posOrderAttempt,
            isAddingItem,
            rawSubtotal,
            discountPercent,
            discountReason,
            partialAmount,
            selectedItems,
            tipAmount,
            isProcessingPayment,
            currentShift,
            finalTotalAmount,
            account: accountSummary,
            accountOrderIds,
            historyRevision,
            latestPayment,
            receiptError,
            receiptLoading,
            lang,
          }}
          actions={{
            setShowAddMenuModal: showAddMenu,
            setSelectedTable: clearSelectedTable,
            handleCancelItem,
            setDiscountPercent,
            previewReceipt,
            setDiscountReason,
            setPartialAmount: (value) => {
              setSelectedItems([]);
              setPartialAmount(value);
            },
            setSelectedItems: (value) => {
              setPartialAmount("");
              setSelectedItems(value);
            },
            setTipAmount: (value) => {
              tipEditedRef.current = true;
              setTipAmount(value);
            },
            handlePayment,
            onReceipt: openStoredReceipt,
            onAccountChange: receivePaymentAccount,
            onRetryPendingOrder: retryPendingPosOrder,
            onChooseTable: returnToTables,
          }}
          formatPrice={formatPrice}
          t={t}
        />
      </div>

      <Dialog
        open={showAddMenuModal && Boolean(selectedTable)}
        onClose={() => showAddMenu(false)}
        title={`${selectedTable?.tableNumber || ""} · ${labels.menuTitle}`}
        className="pos-menu-dialog"
      >
        <label className="pos-menu-search">
          <span>{labels.menuSearch}</span>
          <span className="pos-menu-search-control">
            <Search size={18} aria-hidden="true" />
            <input
              autoFocus
              type="search"
              value={addMenuSearch}
              onChange={(event) => setAddMenuSearch(event.target.value)}
            />
          </span>
        </label>
        {menuError && (
          <p role="alert" className="pos-dialog-error">
            {menuError || labels.menuLoadError}
          </p>
        )}
        <div className="pos-menu-results" aria-label={labels.menuTitle}>
          {filteredMenuItems.length === 0 ? (
            <p className="pos-menu-empty">{labels.noMenu}</p>
          ) : (
            menuPages.items.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={isAddingItem || Boolean(posOrderAttempt) || !posOrderAttemptReady}
                onClick={() => handleAddItemToTable(item)}
                className="pos-menu-result"
              >
                <MenuPhoto src={item.imageUrl} name={item.name} className="menu-photo-pos" />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.category?.name || ""}</small>
                </span>
                <span className="pos-menu-result-price">
                  {formatPrice(item.price)}
                  <Plus size={17} aria-hidden="true" />
                </span>
              </button>
            ))
          )}
        </div>
        {menuPages.pageCount > 1 && (
          <PageControls
            page={menuPages.page}
            pageCount={menuPages.pageCount}
            total={menuPages.total}
            start={menuPages.start}
            end={menuPages.end}
            onChange={menuPages.setPage}
            label={menuPageLabel}
          />
        )}
      </Dialog>

      <Dialog
        open={shiftPanelOpen}
        onClose={() => setShiftPanelOpen(false)}
        title={currentShift ? labels.shiftCloseTitle : labels.shiftOpenTitle}
        className="pos-shift-dialog"
      >
        <p className="pos-dialog-description">
          {currentShift ? labels.closingText : labels.openingText}
        </p>
        <label className="pos-shift-cash-field">
          <span>{currentShift ? labels.countedCash : labels.openingCash}</span>
          <input
            type="text"
            inputMode="decimal"
            value={shiftCash}
            onChange={(event) => setShiftCash(event.target.value)}
            placeholder="0.00"
          />
        </label>
        {shiftError && (
          <p role="alert" className="pos-dialog-error">
            {shiftError}
          </p>
        )}
        <button
          type="button"
          onClick={submitShift}
          disabled={shiftBusy}
          className="pos-dialog-primary"
        >
          {shiftBusy ? labels.saving : currentShift ? labels.closeShift : labels.saveShift}
        </button>
      </Dialog>

      <Dialog
        open={Boolean(cancelItemPending)}
        onClose={() => setCancelItemPending(null)}
        title={labels.cancelTitle}
        className="pos-confirm-dialog"
      >
        <p className="pos-dialog-description">{labels.cancelText(cancelItemPending?.name || "")}</p>
        <div className="pos-dialog-actions">
          <button
            type="button"
            onClick={() => setCancelItemPending(null)}
            className="pos-dialog-secondary"
          >
            {labels.keepItem}
          </button>
          <button type="button" onClick={confirmCancelItem} className="pos-dialog-destructive">
            {labels.cancelAction}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(manualCardPending)}
        onClose={() => setManualCardPending(null)}
        title={labels.manualTitle}
        className="pos-confirm-dialog"
      >
        <p className="pos-dialog-description">{labels.manualText}</p>
        <div className="pos-dialog-actions">
          <button
            type="button"
            onClick={() => setManualCardPending(null)}
            className="pos-dialog-secondary"
          >
            {labels.manualCancel}
          </button>
          <button
            type="button"
            onClick={confirmManualCard}
            disabled={isProcessingPayment}
            className="pos-dialog-primary"
          >
            {labels.manualConfirm}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(closedShiftSummary)}
        onClose={() => setClosedShiftSummary(null)}
        title={labels.closedTitle}
        className="pos-shift-summary-dialog"
      >
        {closedShiftSummary && (
          <>
            <dl className="pos-shift-summary">
              <div>
                <dt>{lang === "en" ? "Opening cash" : "Açılış nakdi"}</dt>
                <dd>{formatPrice(closedShiftSummary.openingCash)}</dd>
              </div>
              <div>
                <dt>{lang === "en" ? "Cash payments" : "Nakit tahsilat"}</dt>
                <dd>{formatPrice(closedShiftSummary.cashPayments)}</dd>
              </div>
              <div>
                <dt>{lang === "en" ? "Cash refunds" : "Nakit iadeler"}</dt>
                <dd>{formatPrice(closedShiftSummary.cashRefunds || 0)}</dd>
              </div>
              <div>
                <dt>{lang === "en" ? "Card refunds" : "Kart iadeler"}</dt>
                <dd>{formatPrice(closedShiftSummary.cardRefunds || 0)}</dd>
              </div>
              <div>
                <dt>{lang === "en" ? "Card payments" : "Kart tahsilatı"}</dt>
                <dd>{formatPrice(closedShiftSummary.cardPayments)}</dd>
              </div>
              <div>
                <dt>{lang === "en" ? "Other payments" : "Diğer tahsilat"}</dt>
                <dd>{formatPrice(closedShiftSummary.otherPayments)}</dd>
              </div>
              <div>
                <dt>{lang === "en" ? "Expected cash" : "Beklenen nakit"}</dt>
                <dd>{formatPrice(closedShiftSummary.expectedCash)}</dd>
              </div>
              <div>
                <dt>{lang === "en" ? "Counted cash" : "Sayılan nakit"}</dt>
                <dd>{formatPrice(closedShiftSummary.closingCash)}</dd>
              </div>
              <div className="is-total">
                <dt>{lang === "en" ? "Difference" : "Sayım farkı"}</dt>
                <dd>{formatPrice(closedShiftSummary.cashDifference)}</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => setClosedShiftSummary(null)}
              className="pos-dialog-primary"
            >
              {t("close") || (lang === "en" ? "Close" : "Kapat")}
            </button>
          </>
        )}
      </Dialog>

      <Dialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={lang === "tr" ? "Tahsilat geçmişi" : "Payment history"}
        className="pos-history-dialog"
      >
        <label className="pos-history-filter">
          {lang === "tr" ? "Masa filtresi" : "Filter by table"}
          <select
            aria-label={lang === "tr" ? "Masa filtresi" : "Filter by table"}
            value={historyTableId}
            onChange={(event) => setHistoryTableId(event.target.value)}
          >
            <option value="">{lang === "tr" ? "Tüm masalar" : "All tables"}</option>
            {tables.map((table) => (
              <option key={table.id} value={table.id}>
                {table.tableNumber} · {table.section}
              </option>
            ))}
          </select>
        </label>
        {receiptLoading && (
          <p role="status">{lang === "tr" ? "Fiş yükleniyor…" : "Loading receipt…"}</p>
        )}
        {receiptError && <p role="alert">{receiptError}</p>}
        {historyOpen && (
          <PosPaymentHistory
            key={historyTableId || "all"}
            tableId={historyTableId}
            version={historyRevision}
            lang={lang}
            formatPrice={formatPrice}
            onReceipt={openStoredReceipt}
            global
          />
        )}
      </Dialog>

      <ReceiptModal isOpen={showReceipt} onClose={() => setShowReceipt(false)} data={receiptData} />
    </div>
  );
}
