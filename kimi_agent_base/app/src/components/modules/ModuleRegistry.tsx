import React from 'react';
import { isCloudModeEnabled } from '../../config/cloud';
import { runWithoutCloudSync, useCollection, useData } from '../../context/DataContext';
import { useSession } from '../../context/SessionContext';
import { replaceCloudCollection } from '../../lib/cloudData';
import { useToast } from '../../context/ToastContext';
import { DEFAULT_PREFERENCES, INVENTORY_MOVEMENT_LINK_OPTIONS, mergePreferences, normalizeInventoryMovementLinkOption, resolveCompanyLogoSrc } from '../../config/preferences';
import { changeCloudPassword } from '../../utils/cloudAuth';
import { checkCloudUsernameAvailability, clearCloudWorkspaceData, createCloudUser, deleteCloudUser, fetchCloudUserRights, prepareCloudWorkspace, saveCloudUserRights, updateCloudUser } from '../../utils/cloudUsers';
import { readSessionUser } from '../../utils/authSession';
import { RIGHTS_ACTIONS, USER_RIGHTS_SECTIONS, getEffectiveRight, type UserRightsRecord } from '../../utils/accessControl';
import { getFinancialYearStatus } from '../../utils/financialYears';

const LoadingModule: React.FC = () => (
  <div className="p-6 text-sm text-text-secondary">Loading module...</div>
);

const LazyModuleBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <React.Suspense fallback={<LoadingModule />}>{children}</React.Suspense>
);

const lazyDefault = <T extends React.ComponentType<any>>(loader: () => Promise<{ default: T }>) =>
  React.lazy(loader);

const lazyNamed = <T extends React.ComponentType<any>>(
  loader: () => Promise<Record<string, unknown>>,
  exportName: string,
) =>
  React.lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as T };
  });

const ChartOfAccountsModule = lazyDefault(() => import('./ChartOfAccountsModule'));
const CustomersModule = lazyDefault(() => import('./CustomersModule'));
const VendorsModule = lazyDefault(() => import('./VendorsModule'));
const ProductsModule = lazyDefault(() => import('./ProductsModule'));
const Reminders = lazyNamed(() => import('../../pages/Reminders'), 'Reminders');
const SimpleListTemplate = lazyDefault(() => import('./SimpleListTemplate'));
const InvoiceTemplate = lazyDefault(() => import('./InvoiceTemplate'));
const PaymentReceiptTemplate = lazyDefault(() => import('./PaymentReceiptTemplate'));
const JournalAdjustmentTemplate = lazyDefault(() => import('./JournalAdjustmentTemplate'));
const SmartReportsModule = lazyDefault(() => import('./SmartReportsModule'));
const WorkersModule = lazyNamed(() => import('./WorkerHRMModules'), 'WorkersModule');
const WorkerAttendanceModule = lazyNamed(() => import('./WorkerHRMModules'), 'WorkerAttendanceModule');
const WorkerAdvancesModule = lazyNamed(() => import('./WorkerHRMModules'), 'WorkerAdvancesModule');
const WorkerPayrollModule = lazyNamed(() => import('./WorkerHRMModules'), 'WorkerPayrollModule');

const normalizeLoginUsername = (value: unknown) => String(value || '').trim().toLowerCase();
const DATA_STORAGE_PREFIX = 'afroz-';
const SERIAL_STORAGE_PREFIX = `${DATA_STORAGE_PREFIX}serial-`;
const CLOUD_COLLECTION_META_STORAGE_KEY = `${DATA_STORAGE_PREFIX}__cloud_collections__`;
const PRESERVED_CLEAR_DATA_COLLECTIONS = new Set(['user-logins', 'user-rights', 'preferences']);

// Dynamic option builders (used by wrapper components below)
function useVendorOptions(withDetails = false) {
  const vendors = useCollection('vendors');
  return [{ value: '', label: '-- Select --' }, ...vendors.map(v => ({ 
    value: v.code || v.id, 
    label: `${v.code} - ${v.name}`,
    details: withDetails ? v : undefined
  }))];
}
function useCustomerOptions(withDetails = false) {
  const customers = useCollection('customers');
  return [{ value: '', label: '-- Select --' }, ...customers.map(c => ({ 
    value: c.code || c.id, 
    label: `${c.code} - ${c.name}`, 
    details: withDetails ? c : undefined,
    isTaxable: withDetails ? c.salesTaxActive : undefined 
  }))];
}
function useProductOptions(withDetails = false) {
  const products = useCollection('products');
  return [{ value: '', label: '-- Select --' }, ...products.map(p => ({
    value: p.code || p.id,
    label: `${p.code} - ${p.name}`,
    rate: withDetails ? (p.salePrice || p.costPrice || p.price1 || 0) : undefined,
    details: withDetails ? p : undefined,
  }))];
}
function useAccountOptions(withDetails = false) {
  const accounts = useCollection('accounts');
  return [{ value: '', label: '-- Select --' }, ...accounts.map(a => ({
    value: a.code || a.id,
    label: `${a.code} - ${a.name}`,
    details: withDetails ? a : undefined,
  }))];
}
function useWarehouseOptions() {
  const warehouses = useCollection('warehouses');
  return [{ value: '', label: '-- Select --' }, ...warehouses.map(w => ({ value: w.name || w.id, label: w.name }))];
}

function getRealWarehouseNames(options: Array<{ value: string; label: string }>) {
  const names = options
    .filter(option => String(option.value || '').trim() !== '')
    .map(option => String(option.label || option.value || '').trim())
    .filter(Boolean);
  return names.length > 0
    ? names
    : options
      .map(option => String(option.label || option.value || '').trim())
      .filter(name => name && name !== '-- Select --');
}
function useCostCentreOptions() {
  const costCentres = useCollection('cost-centres');
  return [{ value: '', label: '-- Select --' }, ...costCentres.map(c => ({ value: c.name || c.id, label: c.name }))];
}
function usePreferences() {
  const prefs = useCollection('preferences');
  return mergePreferences(prefs[0]);
}

const SetupRequiredNotice: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <div className="p-6">
    <div className="mx-auto max-w-2xl rounded-xl border border-border-custom bg-bg-secondary p-6 shadow-card">
      <div className="text-xs font-bold uppercase tracking-[0.3em] text-accent-orange">Setup Required</div>
      <h2 className="mt-3 text-2xl font-bold text-text-primary">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-text-secondary">{message}</p>
    </div>
  </div>
);

function getInlineValue(record: Record<string, any>, ...keys: string[]) {
  return keys.find(key => record?.inline?.[key] !== undefined && record?.inline?.[key] !== null && record?.inline?.[key] !== '')
    ? record.inline[keys.find(key => record?.inline?.[key] !== undefined && record?.inline?.[key] !== null && record?.inline?.[key] !== '') as string]
    : undefined;
}

function toNumber(value: any) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRowQuantity(row: Record<string, any>) {
  const qty = toNumber(row?.qty);
  if (qty > 0) {
    return qty;
  }
  return toNumber(row?.pcs) + toNumber(row?.addQty);
}

function movementKey(product: string, warehouse: string) {
  return `${product}__${warehouse}`;
}

function normalizeStockProduct(value: unknown) {
  return String(value || '').trim();
}

function normalizeStockWarehouse(value: unknown) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === '-- Select --') {
    return '';
  }
  return normalized;
}

function getStockStatus(onHand: number, reorderLevel: number) {
  if (onHand <= 0) return 'Out of Stock';
  if (onHand <= reorderLevel) return 'Low Stock';
  return 'In Stock';
}

function getStatusBadgeClass(status: string) {
  if (status === 'In Stock') return 'bg-green-500/20 text-green-300 border border-green-500/30';
  if (status === 'Low Stock') return 'bg-amber-500/20 text-amber-200 border border-amber-500/30';
  return 'bg-red-500/20 text-red-200 border border-red-500/30';
}

function useInventoryBalances() {
  const prefs = usePreferences();
  const inventoryMovementMode = normalizeInventoryMovementLinkOption(prefs.invMovement as string | null | undefined);
  const products = useCollection('products');
  const purchaseInvoices = useCollection('purchase-invoices');
  const salesTaxInvoices = useCollection('sales-tax-invoices');
  const saleInvoices = useCollection('sale-invoices');
  const purchaseReturns = useCollection('purchase-returns');
  const saleReturnsTax = useCollection('sale-returns-tax');
  const saleReturnsNontax = useCollection('sale-returns-nontax');
  const purchaseInwardGatePasses = useCollection('inwards-gate-passes');
  const purchaseGoodsReceivedNotes = useCollection('goods-received-notes');
  const inwardGatePasses = useCollection('store-inward-gate-passes');
  const goodsReceivedNotes = useCollection('store-goods-received-notes');
  const addInventory = useCollection('store-add-inventory');
  const reduceInventory = useCollection('store-reduce-inventory');
  const deliveryNotes = useCollection('store-delivery-notes');
  const outwardGatePasses = useCollection('store-outwards-gate-passes');
  const stockAdjustments = useCollection('stock-adjustments');
  const transfers = useCollection('store-inventory-transfers');
  const materialIssues = useCollection('store-material-issue-notes');
  const productionNotes = useCollection('store-production-notes');
  const productionAssembly = useCollection('store-production-assembly');

  return React.useMemo(() => {
    const balances = new Map<string, number>();
    const productTotals = new Map<string, { received: number; issued: number; onHand: number }>();
    const warehouseTotals = new Map<string, { received: number; issued: number; onHand: number }>();
    const productWarehouseStockAsOf = new Map<string, number>();
    const aliasToCanonicalProduct = new Map<string, string>();
    const productDefaultWarehouse = new Map<string, string>();

    const registerAlias = (aliasInput: unknown, canonicalInput: unknown) => {
      const alias = String(aliasInput || '').trim().toLowerCase();
      const canonical = normalizeStockProduct(canonicalInput);
      if (!alias || !canonical) {
        return;
      }
      aliasToCanonicalProduct.set(alias, canonical);
    };

    products.forEach((productRecord: Record<string, any>) => {
      const canonicalKey = normalizeStockProduct(productRecord.code || productRecord.id);
      if (!canonicalKey) {
        return;
      }
      registerAlias(productRecord.code, canonicalKey);
      registerAlias(productRecord.id, canonicalKey);
      registerAlias(productRecord.name, canonicalKey);
      const defaultWarehouse = normalizeStockWarehouse(productRecord.warehouse);
      if (defaultWarehouse) {
        productDefaultWarehouse.set(canonicalKey, defaultWarehouse);
      }
    });

    const resolveCanonicalProduct = (productInput: unknown) => {
      const direct = normalizeStockProduct(productInput);
      if (!direct) {
        return '';
      }
      const exact = aliasToCanonicalProduct.get(direct.toLowerCase());
      if (exact) {
        return exact;
      }
      return direct;
    };

    const parseRecordTimestamp = (record: Record<string, any>) => {
      const savedAt = String(record?.savedAt || '').trim();
      if (!savedAt) {
        return null;
      }
      const parsed = Date.parse(savedAt);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const shouldApplyRecordMovement = (productInput: unknown, warehouseInput: unknown, record: Record<string, any>) => {
      const product = resolveCanonicalProduct(productInput);
      const warehouse = normalizeStockWarehouse(warehouseInput);
      if (!product || !warehouse) {
        return false;
      }
      const stockAsOf = productWarehouseStockAsOf.get(movementKey(product, warehouse));
      if (!stockAsOf) {
        return true;
      }
      const recordTimestamp = parseRecordTimestamp(record);
      if (!recordTimestamp) {
        // When user resets stock for a product, records without timestamps are
        // treated as legacy history and must not override the new baseline.
        return false;
      }
      return recordTimestamp > stockAsOf;
    };

    const applyMovement = (productInput: unknown, warehouseInput: unknown, qtyDelta: number) => {
      const product = resolveCanonicalProduct(productInput);
      const warehouse = normalizeStockWarehouse(warehouseInput);
      if (!product || !warehouse || !qtyDelta) return;
      const key = movementKey(product, warehouse);
      balances.set(key, (balances.get(key) || 0) + qtyDelta);

      const current = productTotals.get(product) || { received: 0, issued: 0, onHand: 0 };
      if (qtyDelta > 0) {
        current.received += qtyDelta;
      } else {
        current.issued += Math.abs(qtyDelta);
      }
      current.onHand += qtyDelta;
      productTotals.set(product, current);

      const warehouseBalanceKey = movementKey(product, warehouse);
      const warehouseCurrent = warehouseTotals.get(warehouseBalanceKey) || { received: 0, issued: 0, onHand: 0 };
      if (qtyDelta > 0) {
        warehouseCurrent.received += qtyDelta;
      } else {
        warehouseCurrent.issued += Math.abs(qtyDelta);
      }
      warehouseCurrent.onHand += qtyDelta;
      warehouseTotals.set(warehouseBalanceKey, warehouseCurrent);
    };

    products.forEach((productRecord: Record<string, any>) => {
      const productKey = resolveCanonicalProduct(productRecord.code || productRecord.id);
      const warehouseKey = normalizeStockWarehouse(productRecord.warehouse);
      const openingStock = toNumber(productRecord.stock);
      const stockAsOfRaw = String(productRecord.stockAsOf || '').trim();
      if (productKey && warehouseKey && stockAsOfRaw) {
        const parsedStockAsOf = Date.parse(stockAsOfRaw);
        if (Number.isFinite(parsedStockAsOf)) {
          const stockAsOfKey = movementKey(productKey, warehouseKey);
          const currentStockAsOf = productWarehouseStockAsOf.get(stockAsOfKey) || 0;
          productWarehouseStockAsOf.set(stockAsOfKey, Math.max(currentStockAsOf, parsedStockAsOf));
        }
      }
      if (!productKey || !warehouseKey || openingStock <= 0) {
        return;
      }

      applyMovement(productKey, warehouseKey, openingStock);
    });

    const applyStandardRows = (records: any[], direction: 1 | -1) => {
      records.forEach(record => {
        const recordWarehouse = normalizeStockWarehouse(record?.warehouse);
        const lineItems = Array.isArray(record?.rows)
          ? record.rows
          : (Array.isArray(record?.items) ? record.items : []);
        lineItems.forEach((row: Record<string, any>) => {
          const product = resolveCanonicalProduct(row.product || row.item);
          const rowWarehouse = normalizeStockWarehouse(
            row.warehouse
            || recordWarehouse
            || productDefaultWarehouse.get(product)
            || '',
          );
          if (!shouldApplyRecordMovement(product, rowWarehouse, record)) {
            return;
          }
          applyMovement(product, rowWarehouse, direction * getRowQuantity(row));
        });
      });
    };

    const primaryInboundGatePasses = inwardGatePasses.length > 0 ? inwardGatePasses : purchaseInwardGatePasses;
    const primaryGoodsReceivedNotes = goodsReceivedNotes.length > 0 ? goodsReceivedNotes : purchaseGoodsReceivedNotes;
    const primarySaleInvoices = [...saleInvoices, ...salesTaxInvoices];
    const saleReturnDocs = [...saleReturnsTax, ...saleReturnsNontax];

    // Always reflect direct sales/purchase invoices as stock movement.
    // This keeps core buy/sell flow reliable regardless of linked-document preference.
    applyStandardRows(primarySaleInvoices, -1);
    applyStandardRows(purchaseInvoices, 1);

    if (inventoryMovementMode === 'Purchase Invoices & Sale Invoices') {
      // Purchase invoices already applied above.
    } else if (inventoryMovementMode === 'Purchase Invoices & Delivery Notes') {
      // Purchase invoices already applied above.
      applyStandardRows(deliveryNotes, -1);
    } else if (inventoryMovementMode === 'Inwards & Outwards Gate Passes') {
      applyStandardRows(primaryInboundGatePasses, 1);
      applyStandardRows(outwardGatePasses, -1);
    } else if (inventoryMovementMode === 'Inwards Gate Passes & Delivery Notes') {
      applyStandardRows(primaryInboundGatePasses, 1);
      applyStandardRows(deliveryNotes, -1);
    } else {
      applyStandardRows(primaryGoodsReceivedNotes, 1);
      applyStandardRows(deliveryNotes, -1);
    }

    applyStandardRows(purchaseReturns, -1);
    applyStandardRows(saleReturnDocs, 1);
    applyStandardRows(addInventory, 1);
    applyStandardRows(reduceInventory, -1);
    applyStandardRows(materialIssues, -1);

    stockAdjustments.forEach(record => {
      const adjustmentType = String(getInlineValue(record, 'adjustmentType', 'Adjustment Type') || 'Add').toLowerCase();
      const direction = adjustmentType === 'reduce' ? -1 : 1;
      const recordWarehouse = normalizeStockWarehouse(record?.warehouse);
      (record.rows || []).forEach((row: Record<string, any>) => {
        const product = resolveCanonicalProduct(row.product || row.item);
        const rowWarehouse = normalizeStockWarehouse(
          row.warehouse
          || recordWarehouse
          || productDefaultWarehouse.get(product)
          || '',
        );
        if (!shouldApplyRecordMovement(product, rowWarehouse, record)) {
          return;
        }
        applyMovement(product, rowWarehouse, direction * getRowQuantity(row));
      });
    });

    transfers.forEach(record => {
      const recordWarehouse = normalizeStockWarehouse(record?.warehouse);
      (record.rows || []).forEach((row: Record<string, any>) => {
        const qty = getRowQuantity(row);
        const fromWarehouse = normalizeStockWarehouse(row.fromWarehouse || row.warehouse || recordWarehouse);
        const toWarehouse = normalizeStockWarehouse(row.toWarehouse || record?.toWarehouse);
        const normalizedProduct = resolveCanonicalProduct(row.product || row.item);
        // Ignore malformed transfer rows so one-sided stock moves cannot corrupt balances.
        if (!normalizedProduct || qty <= 0 || !fromWarehouse || !toWarehouse || fromWarehouse === toWarehouse) {
          return;
        }
        const shouldApplyFrom = shouldApplyRecordMovement(normalizedProduct, fromWarehouse, record);
        const shouldApplyTo = shouldApplyRecordMovement(normalizedProduct, toWarehouse, record);
        if (!shouldApplyFrom && !shouldApplyTo) {
          return;
        }
        if (shouldApplyFrom) {
          applyMovement(normalizedProduct, fromWarehouse, -qty);
        }
        if (shouldApplyTo) {
          applyMovement(normalizedProduct, toWarehouse, qty);
        }
      });
    });

    [...productionNotes, ...productionAssembly].forEach(record => {
      (record.rows || []).forEach((row: Record<string, any>) => {
        const product = resolveCanonicalProduct(row.product || row.item);
        const outputWarehouse = normalizeStockWarehouse(row.warehouse || productDefaultWarehouse.get(product) || '');
        if (!shouldApplyRecordMovement(product, outputWarehouse, record)) {
          return;
        }
        applyMovement(product, outputWarehouse, -getRowQuantity(row));
      });

      const finishedProduct = resolveCanonicalProduct(getInlineValue(record, 'finishedProduct', 'Finished Product', 'Produced Item'));
      const outputWarehouse = normalizeStockWarehouse(
        getInlineValue(record, 'outputWarehouse', 'Output Warehouse')
        || record.rows?.[0]?.warehouse
        || productDefaultWarehouse.get(finishedProduct)
        || '',
      );
      if (!shouldApplyRecordMovement(finishedProduct, outputWarehouse, record)) {
        return;
      }
      const outputQty = toNumber(getInlineValue(record, 'outputQty', 'Yield Qty', 'Output Qty'));
      applyMovement(finishedProduct, outputWarehouse, outputQty);
    });

    return {
      getAvailableQty(productInput: string, warehouseInput: string) {
        const product = resolveCanonicalProduct(productInput);
        const warehouse = normalizeStockWarehouse(warehouseInput);
        if (!product || !warehouse) {
          return 0;
        }
        return Math.max(0, balances.get(movementKey(product, warehouse)) || 0);
      },
      getProductSummary(productInput: string) {
        const product = resolveCanonicalProduct(productInput);
        const summary = productTotals.get(product) || { received: 0, issued: 0, onHand: 0 };
        return { ...summary, onHand: Math.max(0, summary.onHand || 0) };
      },
      getWarehouseSummary(productInput: string, warehouseInput: string) {
        const product = resolveCanonicalProduct(productInput);
        const warehouse = normalizeStockWarehouse(warehouseInput);
        const summary = warehouseTotals.get(movementKey(product, warehouse)) || { received: 0, issued: 0, onHand: 0 };
        return { ...summary, onHand: Math.max(0, summary.onHand || 0) };
      },
    };
  }, [
    products,
    inventoryMovementMode,
    purchaseInvoices,
    salesTaxInvoices,
    saleInvoices,
    purchaseReturns,
    saleReturnsTax,
    saleReturnsNontax,
    purchaseInwardGatePasses,
    purchaseGoodsReceivedNotes,
    inwardGatePasses,
    goodsReceivedNotes,
    addInventory,
    reduceInventory,
    deliveryNotes,
    outwardGatePasses,
    stockAdjustments,
    transfers,
    materialIssues,
    productionNotes,
    productionAssembly,
  ]);
}

function useLatestBOMMap() {
  const bomRecords = useCollection('store-bill-of-materials');

  return React.useMemo(() => {
    const latestByProduct = new Map<string, any>();
    bomRecords.forEach(record => {
      const finishedProduct = String(getInlineValue(record, 'finishedProduct', 'Finished Product') || '');
      if (finishedProduct) {
        latestByProduct.set(finishedProduct, record);
      }
    });
    return latestByProduct;
  }, [bomRecords]);
}

// Purchase Invoice common columns (product options injected dynamically via wrapper components below)
const purchaseItemColumnsBase = [
  { key: 'item', label: 'Item', type: 'select' as const, options: [] as any[] },
  { key: 'hscode', label: 'H.S. Code', type: 'text' as const },
  { key: 'model', label: 'Model No.', type: 'text' as const },
  { key: 'size', label: 'Size', type: 'text' as const },
  { key: 'colour', label: 'Colour', type: 'text' as const },
  { key: 'addQty', label: 'Add Qty', type: 'number' as const, defaultValue: 0 },
  { key: 'pcs', label: 'Pcs', type: 'number' as const, defaultValue: 0 },
  { key: 'focPacks', label: 'FOC Packs', type: 'number' as const, defaultValue: 0 },
  { key: 'focPcs', label: 'FOC Pcs', type: 'number' as const, defaultValue: 0 },
  { key: 'batch', label: 'Batch No.', type: 'text' as const },
  { key: 'warehouse', label: 'Warehouse', type: 'select' as const, options: [] as any[] },
  { key: 'availableQty', label: 'Available', type: 'text' as const, defaultValue: '', readOnly: true },
  { key: 'availabilityStatus', label: 'Stock Status', type: 'text' as const, defaultValue: '', readOnly: true },
  { key: 'mfgDate', label: 'Mfg. Date', type: 'date' as const },
  { key: 'unit', label: 'Unit', type: 'text' as const, defaultValue: 'Pcs' },
  { key: 'packing', label: 'Packing', type: 'text' as const },
  { key: 'mrp', label: 'MRP', type: 'number' as const, defaultValue: 0 },
  { key: 'rate', label: 'Rate', type: 'number' as const, defaultValue: 0 },
  { key: 'gross', label: 'Gross', type: 'number' as const, defaultValue: 0 },
  { key: 'discPct', label: 'Disc %', type: 'number' as const, defaultValue: 0 },
  { key: 'discAmt', label: 'Disc Amt', type: 'number' as const, defaultValue: 0 },
  { key: 'salesTax', label: 'Sales Tax %', type: 'number' as const, defaultValue: 0 },
  { key: 'fed', label: 'F.E.D. %', type: 'number' as const, defaultValue: 0 },
  { key: 'extraTax', label: 'Extra Tax %', type: 'number' as const, defaultValue: 0 },
  { key: 'furtherTax', label: 'Further Tax %', type: 'number' as const, defaultValue: 0 },
  { key: 'net', label: 'Net', type: 'number' as const, defaultValue: 0 },
];

const saleItemColumnsBase = [
  { key: 'item', label: 'Item', type: 'select' as const, options: [] as any[] },
  { key: 'hscode', label: 'H.S. Code', type: 'text' as const },
  { key: 'model', label: 'Model No.', type: 'text' as const },
  { key: 'size', label: 'Size', type: 'text' as const },
  { key: 'colour', label: 'Colour', type: 'text' as const },
  { key: 'addQty', label: 'Add Qty', type: 'number' as const, defaultValue: 0 },
  { key: 'pcs', label: 'Pcs', type: 'number' as const, defaultValue: 0 },
  { key: 'focPacks', label: 'FOC Packs', type: 'number' as const, defaultValue: 0 },
  { key: 'focPcs', label: 'FOC Pcs', type: 'number' as const, defaultValue: 0 },
  { key: 'batch', label: 'Batch No.', type: 'text' as const },
  { key: 'warehouse', label: 'Warehouse', type: 'select' as const, options: [] as any[] },
  { key: 'availableQty', label: 'Available (Before -> After)', type: 'text' as const, defaultValue: '', readOnly: true },
  { key: 'remainingQty', label: 'Total Stock', type: 'text' as const, defaultValue: '', readOnly: true },
  { key: 'availabilityStatus', label: 'Stock Status', type: 'text' as const, defaultValue: '', readOnly: true },
  { key: 'mfgDate', label: 'Mfg. Date', type: 'date' as const },
  { key: 'unit', label: 'Unit', type: 'text' as const, defaultValue: 'Pcs' },
  { key: 'packing', label: 'Packing', type: 'text' as const },
  { key: 'mrp', label: 'MRP', type: 'number' as const, defaultValue: 0 },
  { key: 'rate', label: 'Rate', type: 'number' as const, defaultValue: 0 },
  { key: 'salesTax', label: 'Sales Tax %', type: 'number' as const, defaultValue: 17 },
  { key: 'fed', label: 'F.E.D. %', type: 'number' as const, defaultValue: 0 },
  { key: 'extraTax', label: 'Extra Tax %', type: 'number' as const, defaultValue: 0 },
  { key: 'furtherTax', label: 'Further Tax %', type: 'number' as const, defaultValue: 0 },
  { key: 'gross', label: 'Gross', type: 'number' as const, defaultValue: 0 },
  { key: 'discPct', label: 'Disc %', type: 'number' as const, defaultValue: 0 },
  { key: 'discAmt', label: 'Disc Amt', type: 'number' as const, defaultValue: 0 },
  { key: 'net', label: 'Net', type: 'number' as const, defaultValue: 0 },
];

const purchaseHeaderRows = [
  { fields: [
    { label: 'Serial', type: 'number' as const, value: '1' },
    { label: 'Date', type: 'date' as const },
  ] },
  { fields: [
    { label: 'Quotation No.' },
    { label: 'Date', type: 'date' as const },
  ] },
  { fields: [
    { label: 'Delivery Date', type: 'date' as const },
  ] },
];

const salesTaxHeaderRows = [
  { fields: [
    { label: 'Serial', type: 'number' as const, value: '1' },
    { label: 'Date', type: 'date' as const },
  ] },
  { fields: [
    { label: 'Cust. P.O. No.' },
    { label: 'Date', type: 'date' as const },
  ] },
  { fields: [
    { label: 'D.C. No.' },
    { label: 'Date', type: 'date' as const },
  ] },
  { fields: [
    { label: 'Credit Terms' },
    { label: 'Due Date', type: 'date' as const },
  ] },
];


// ── Dynamic wrapper components (inject live options from DataContext) ──

const injectOptions = (cols: any[], key: string, opts: any[]) => cols.map(c => c.key === key ? { ...c, options: opts } : c);

const getInvoiceRowQuantity = (row: Record<string, any>) => {
  const qty = toNumber(row?.qty);
  if (qty > 0) {
    return qty;
  }
  return toNumber(row?.pcs) + toNumber(row?.addQty);
};

const DynPurchaseInvoice: React.FC<{ title: string; statusText?: string; storageKey?: string; moduleId?: string }> = ({ title, statusText, storageKey, moduleId }) => {
  const vendorOpts = useVendorOptions(true);
  const productOpts = useProductOptions(true);
  const warehouseOpts = useWarehouseOptions();
  const costCentreOpts = useCostCentreOptions();
  const warehouseNames = getRealWarehouseNames(warehouseOpts);
  const costCentreNames = costCentreOpts.map(option => String(option.label || option.value || '')).filter(Boolean);
  const inventoryBalances = useInventoryBalances();
  const prefs = usePreferences();
  const hasVendors = vendorOpts.length > 1;
  const hasProducts = productOpts.length > 1;
  const hasWarehouses = warehouseOpts.length > 1;

  if (!hasVendors || !hasProducts || !hasWarehouses) {
    return (
      <SetupRequiredNotice
        title={`${title} is not ready yet`}
        message="Create at least one vendor, one product, and one warehouse before using this module."
      />
    );
  }

  const salesTaxLabel = String(prefs.fedSalesTax || prefs.stateSalesTax || 'Sales Tax');
  const fedLabel = String(prefs.fedDesc || 'F.E.D.');
  const extraTaxLabel = String(prefs.extraTax || 'Extra Tax');
  const furtherTaxLabel = String(prefs.furtherTax || 'Further Tax');
  const defaultTax = Number(prefs.defaultTax ?? 0);
  const partyFields = [
    { label: 'Vendor', type: 'select' as const, options: vendorOpts }, 
    { label: 'Name', isReadOnly: true }, 
    { label: 'Address', isReadOnly: true }, 
    { label: 'Contact', isReadOnly: true }
  ];
  const cols = injectOptions(injectOptions(purchaseItemColumnsBase, 'item', productOpts), 'warehouse', warehouseOpts).map((c: any) => {
    if (c.key === 'warehouse') return { ...c, defaultValue: warehouseNames[0] || '' };
    if (c.key === 'salesTax') return { ...c, label: `${salesTaxLabel} %`, defaultValue: defaultTax };
    if (c.key === 'fed') return { ...c, label: `${fedLabel} %` };
    if (c.key === 'extraTax') return { ...c, label: `${extraTaxLabel} %` };
    if (c.key === 'furtherTax') return { ...c, label: `${furtherTaxLabel} %` };
    return c;
  });
  const validatePurchaseRows = (rows: Record<string, any>[]) => {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      const product = String(row.product || row.item || '').trim();
      if (!product) continue;
      const rowNumber = index + 1;
      const rowWarehouse = normalizeStockWarehouse(row.warehouse);
      if (!rowWarehouse) {
        return `Row ${rowNumber}: warehouse is required for ${product}.`;
      }
      const qty = getInvoiceRowQuantity(row);
      if (qty <= 0) {
        return `Row ${rowNumber}: quantity must be greater than zero for ${product}.`;
      }
    }
    return null;
  };
  const decorateRow = (row: Record<string, any>) => {
    const productValue = String(row.product || row.item || '');
    const details = (productOpts.find(option => option.value === productValue) as any)?.details;
    const warehouseValue = String(row.warehouse || details?.warehouse || warehouseNames[0] || '').trim();
    const available = productValue && warehouseValue ? inventoryBalances.getAvailableQty(productValue, warehouseValue) : 0;
    const reorderLevel = Number(details?.reorderLevel || details?.reorder || 20);
    return {
      ...row,
      availableQty: productValue && warehouseValue ? available.toFixed(2) : '',
      availabilityStatus: productValue && warehouseValue ? getStockStatus(available, reorderLevel) : '',
    };
  };
  return <LazyModuleBoundary><InvoiceTemplate title={title} statusText={statusText} storageKey={storageKey} moduleId={moduleId} headerRows={purchaseHeaderRows} partyFields={partyFields} itemColumns={cols} costCentres={costCentreNames} warehouses={warehouseNames} showWarehouse={false} useHeaderWarehouseAsRowDefault={false} autoFillRate decorateRow={decorateRow} validateBeforeSave={validatePurchaseRows} /></LazyModuleBoundary>;
};

const DynSaleInvoice: React.FC<{
  title: string;
  statusText?: string;
  storageKey?: string;
  moduleId?: string;
  taxMode?: 'tax' | 'nonTax' | 'neutral';
  requirePartyTaxIds?: boolean;
  serialPrefix?: string;
  showTaxSummary?: boolean;
}> = ({
  title,
  statusText,
  storageKey,
  moduleId,
  taxMode = 'neutral',
  requirePartyTaxIds = false,
  serialPrefix = '',
  showTaxSummary = true,
}) => {
  const customerOpts = useCustomerOptions(true);
  const productOpts = useProductOptions(true);
  const products = useCollection('products');
  const warehouseOpts = useWarehouseOptions();
  const costCentreOpts = useCostCentreOptions();
  const warehouseNames = getRealWarehouseNames(warehouseOpts);
  const costCentreNames = costCentreOpts.map(option => String(option.label || option.value || '')).filter(Boolean);
  const inventoryBalances = useInventoryBalances();
  const prefs = usePreferences();
  const hasCustomers = customerOpts.length > 1;
  const hasProducts = productOpts.length > 1;
  const hasWarehouses = warehouseOpts.length > 1;
  const setupNotice = (!hasCustomers || !hasProducts || !hasWarehouses)
    ? (
      <SetupRequiredNotice
        title={`${title} is not ready yet`}
        message="Create at least one customer, one product, and one warehouse before using this module."
      />
    )
    : null;

  const taxRate = Number(prefs.defaultTax ?? 17);
  const furtherTaxRate = Number(prefs.furtherTaxRate ?? 3);
  const salesTaxLabel = String(prefs.fedSalesTax || prefs.stateSalesTax || 'Sales Tax');
  const fedLabel = String(prefs.fedDesc || 'F.E.D.');
  const extraTaxLabel = String(prefs.extraTax || 'Extra Tax');
  const furtherTaxLabel = String(prefs.furtherTax || 'Further Tax');
  const partyFields = [
    { label: 'Customer', type: 'select' as const, options: customerOpts }, 
    { label: 'Name', isReadOnly: true }, 
    { label: 'Address', isReadOnly: true }, 
    { label: 'Contact', isReadOnly: true }, 
    { label: 'N.T.N.', isReadOnly: true }, 
    { label: 'S.T.R.N.', isReadOnly: true }
  ];
  const cols = injectOptions(injectOptions(saleItemColumnsBase, 'item', productOpts), 'warehouse', warehouseOpts).map((c: any) => {
    if (taxMode === 'nonTax' && (c.key === 'salesTax' || c.key === 'fed' || c.key === 'extraTax' || c.key === 'furtherTax')) {
      return { ...c, defaultValue: 0, readOnly: true };
    }
    if (c.key === 'salesTax') return { ...c, label: `${salesTaxLabel} %`, defaultValue: taxRate };
    if (c.key === 'fed') return { ...c, label: `${fedLabel} %` };
    if (c.key === 'extraTax') return { ...c, label: `${extraTaxLabel} %` };
    if (c.key === 'furtherTax') return { ...c, label: `${furtherTaxLabel} %`, defaultValue: 0 };
    return c;
  });

  const productDetailsByCode = React.useMemo(() => {
    const map = new Map<string, Record<string, any>>();
    productOpts.forEach((option: any) => {
      const code = String(option?.value || '').trim();
      if (!code) return;
      map.set(code, (option?.details || {}) as Record<string, any>);
    });
    return map;
  }, [productOpts]);

  const resolveProductRecord = React.useCallback((rawValue: unknown) => {
    const value = String(rawValue || '').trim();
    if (!value) return null;
    const normalizedValue = value.toLowerCase();

    const exact = products.find((record: Record<string, any>) => {
      const code = String(record.code || record.id || '').trim();
      return code && code.toLowerCase() === normalizedValue;
    });
    if (exact) return exact;

    const prefix = products.find((record: Record<string, any>) => {
      const code = String(record.code || record.id || '').trim().toLowerCase();
      return code && (code.startsWith(normalizedValue) || normalizedValue.startsWith(code));
    });
    if (prefix) return prefix;

    const byName = products.find((record: Record<string, any>) => {
      const name = String(record.name || '').trim().toLowerCase();
      return name && name === normalizedValue;
    });
    return byName || null;
  }, [products]);

  const resolveProductDetails = React.useCallback((rawValue: unknown) => {
    const value = String(rawValue || '').trim();
    if (!value) return {} as Record<string, any>;
    const fromOptions = productDetailsByCode.get(value);
    if (fromOptions && Object.keys(fromOptions).length > 0) {
      return fromOptions;
    }
    const fromProducts = resolveProductRecord(value);
    return (fromProducts || {}) as Record<string, any>;
  }, [productDetailsByCode, resolveProductRecord]);

  const getRelatedProductKeys = React.useCallback((rawValue: unknown) => {
    const productRecord = resolveProductRecord(rawValue);
    if (!productRecord) {
      const fallback = String(rawValue || '').trim();
      return fallback ? [fallback] : [];
    }

    const productName = String(productRecord.name || '').trim().toLowerCase();
    const productCode = String(productRecord.code || productRecord.id || '').trim().toLowerCase();
    const keys = new Set<string>();

    products.forEach((record: Record<string, any>) => {
      const recordName = String(record.name || '').trim().toLowerCase();
      const recordCode = String(record.code || record.id || '').trim().toLowerCase();
      if ((productName && recordName && recordName === productName) || (productCode && recordCode && recordCode === productCode)) {
        const key = String(record.code || record.id || '').trim();
        if (key) {
          keys.add(key);
        }
      }
    });

    if (keys.size === 0) {
      const fallbackKey = String(productRecord.code || productRecord.id || '').trim();
      if (fallbackKey) {
        keys.add(fallbackKey);
      }
    }

    return Array.from(keys);
  }, [products, resolveProductRecord]);

  const getMasterStockBreakdown = React.useCallback((rawValue: unknown, warehouse: string) => {
    const productRecord = resolveProductRecord(rawValue);
    if (!productRecord) {
      return { found: false, total: 0, warehouse: 0 };
    }

    const productName = String(productRecord.name || '').trim().toLowerCase();
    const productCode = String(productRecord.code || productRecord.id || '').trim().toLowerCase();
    const targetWarehouse = String(warehouse || '').trim().toLowerCase();

    const relatedRecords = products.filter((record: Record<string, any>) => {
      const recordName = String(record.name || '').trim().toLowerCase();
      const recordCode = String(record.code || record.id || '').trim().toLowerCase();
      if (productName && recordName && recordName === productName) {
        return true;
      }
      return productCode && recordCode && recordCode === productCode;
    });

    const pool = relatedRecords.length > 0 ? relatedRecords : [productRecord];
    let total = 0;
    let warehouseTotal = 0;

    pool.forEach((record: Record<string, any>) => {
      const stockValue = Math.max(0, toNumber(record.stock));
      total += stockValue;
      const recordWarehouse = String(record.warehouse || '').trim().toLowerCase();
      if (targetWarehouse && recordWarehouse === targetWarehouse) {
        warehouseTotal += stockValue;
      }
    });

    return {
      found: true,
      total,
      warehouse: warehouseTotal,
    };
  }, [products, resolveProductRecord]);

  const resolveEffectiveWarehouse = React.useCallback((row: Record<string, any>) => {
    return normalizeStockWarehouse(row.warehouse);
  }, []);

  const getProductDemandGroupKey = React.useCallback((rawValue: unknown) => {
    const relatedKeys = getRelatedProductKeys(rawValue).map((key) => String(key || '').trim()).filter(Boolean);
    if (relatedKeys.length === 0) {
      return String(rawValue || '').trim();
    }
    return Array.from(new Set(relatedKeys)).sort().join('|');
  }, [getRelatedProductKeys]);

  const getWarehouseBaseAvailable = React.useCallback((product: string, warehouse: string) => {
    const relatedKeys = getRelatedProductKeys(product);
    if (relatedKeys.length > 0) {
      // Warehouse-level availability must stay warehouse-specific.
      // Never borrow stock from other warehouses for this row.
      const movementAvailable = relatedKeys.reduce((sum, key) => sum + inventoryBalances.getAvailableQty(key, warehouse), 0);
      const hasMovementHistory = relatedKeys.some((key) => {
        const summary = inventoryBalances.getWarehouseSummary(key, warehouse);
        return Math.abs(summary.received || 0) > 1e-9 || Math.abs(summary.issued || 0) > 1e-9;
      });
      if (hasMovementHistory) {
        return movementAvailable;
      }
    }
    const stockBreakdown = getMasterStockBreakdown(product, warehouse);
    if (stockBreakdown.found) {
      return stockBreakdown.warehouse;
    }
    return inventoryBalances.getAvailableQty(product, warehouse);
  }, [getMasterStockBreakdown, getRelatedProductKeys, inventoryBalances]);

  const getProductBaseAvailable = React.useCallback((product: string) => {
    const relatedKeys = getRelatedProductKeys(product);
    if (relatedKeys.length > 0) {
      const movementAvailable = relatedKeys.reduce((sum, key) => sum + inventoryBalances.getProductSummary(key).onHand, 0);
      const hasMovementHistory = relatedKeys.some((key) => {
        const summary = inventoryBalances.getProductSummary(key);
        return Math.abs(summary.received || 0) > 1e-9 || Math.abs(summary.issued || 0) > 1e-9;
      });
      if (hasMovementHistory) {
        return movementAvailable;
      }
    }
    const stockBreakdown = getMasterStockBreakdown(product, '');
    if (stockBreakdown.found) {
      return stockBreakdown.total;
    }
    return inventoryBalances.getProductSummary(product).onHand;
  }, [getMasterStockBreakdown, getRelatedProductKeys, inventoryBalances]);

  const computeRowMetrics = React.useCallback((rows: Record<string, any>[]) => {
    const consumedByWarehouse = new Map<string, number>();
    const baseWarehouseByKey = new Map<string, number>();
    const baseTotalByProduct = new Map<string, number>();
    const consumedByProduct = new Map<string, number>();

    return rows.map((row) => {
      const product = String(row.product || row.item || '').trim();
      const warehouse = resolveEffectiveWarehouse(row);
      const qty = getInvoiceRowQuantity(row);
      if (!product || !warehouse) {
        return {
          qty: 0,
          warehouseAvailableBefore: 0,
          totalAvailableBefore: 0,
          warehouseRemainingAfter: 0,
          totalRemainingAfter: 0,
        };
      }

      const productGroupKey = getProductDemandGroupKey(product);
      const warehouseKey = movementKey(productGroupKey, warehouse);
      if (!baseWarehouseByKey.has(warehouseKey)) {
        baseWarehouseByKey.set(warehouseKey, getWarehouseBaseAvailable(product, warehouse));
      }
      if (!baseTotalByProduct.has(productGroupKey)) {
        baseTotalByProduct.set(productGroupKey, getProductBaseAvailable(product));
      }

      const warehouseBase = baseWarehouseByKey.get(warehouseKey) || 0;
      const totalBase = baseTotalByProduct.get(productGroupKey) || 0;
      const consumedWarehouse = consumedByWarehouse.get(warehouseKey) || 0;
      const consumedTotal = consumedByProduct.get(productGroupKey) || 0;
      const warehouseAvailableBefore = Math.max(0, warehouseBase - consumedWarehouse);
      const totalAvailableBefore = Math.max(0, totalBase - consumedTotal);
      const requestedQty = Math.max(0, qty);
      const consumableQty = Math.min(requestedQty, warehouseAvailableBefore, totalAvailableBefore);
      const warehouseRemainingAfter = Math.max(0, warehouseAvailableBefore - consumableQty);
      const totalRemainingAfter = Math.max(0, totalAvailableBefore - consumableQty);

      if (consumableQty > 0) {
        consumedByWarehouse.set(warehouseKey, consumedWarehouse + consumableQty);
        consumedByProduct.set(productGroupKey, consumedTotal + consumableQty);
      }

      return {
        qty,
        warehouseAvailableBefore,
        totalAvailableBefore,
        warehouseRemainingAfter,
        totalRemainingAfter,
      };
    });
  }, [getProductBaseAvailable, getProductDemandGroupKey, getWarehouseBaseAvailable, resolveEffectiveWarehouse]);

  const getRowMetrics = React.useCallback((rows: Record<string, any>[], rowIndex: number) => {
    return computeRowMetrics(rows)[rowIndex] || {
      qty: 0,
      warehouseAvailableBefore: 0,
      totalAvailableBefore: 0,
      warehouseRemainingAfter: 0,
      totalRemainingAfter: 0,
    };
  }, [computeRowMetrics]);

  const validateRowsAgainstAvailability = React.useCallback((rows: Record<string, any>[]) => {
    const metricsRows = computeRowMetrics(rows);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      const rowNumber = index + 1;
      const product = String(row.product || row.item || '').trim();
      const warehouse = resolveEffectiveWarehouse(row);
      const qty = getInvoiceRowQuantity(row);
      if (!product || qty <= 0) {
        continue;
      }
      if (!warehouse) {
        return `Row ${rowNumber}: warehouse is required for ${product}.`;
      }

      const metrics = metricsRows[index] || {
        warehouseAvailableBefore: 0,
        totalAvailableBefore: 0,
      };
      if (qty > metrics.warehouseAvailableBefore + 1e-9) {
        return `Insufficient stock for ${product} in ${warehouse}. Available: ${Math.max(0, metrics.warehouseAvailableBefore).toFixed(2)}, required: ${qty.toFixed(2)}.`;
      }
    }

    return null;
  }, [computeRowMetrics, resolveEffectiveWarehouse]);

  const decorateRow = (
    row: Record<string, any>,
    _changedKey?: string,
    context?: { rowIndex: number; rows: Record<string, any>[] },
  ) => {
    const productValue = String(row.product || row.item || '');
    const details = resolveProductDetails(productValue);
    const warehouseValue = resolveEffectiveWarehouse(row);
    const metrics = context
      ? getRowMetrics(context.rows, context.rowIndex)
      : { qty: 0, warehouseAvailableBefore: 0, totalAvailableBefore: 0, warehouseRemainingAfter: 0, totalRemainingAfter: 0 };
    const warehouseAvailable = productValue && warehouseValue ? metrics.warehouseAvailableBefore : 0;
    const totalAvailable = productValue ? metrics.totalAvailableBefore : 0;
    const warehouseRemaining = productValue && warehouseValue ? metrics.warehouseRemainingAfter : 0;
    const reorderLevel = Number(details?.reorderLevel || details?.reorder || 20);
    return {
      ...row,
      availableQty: productValue && warehouseValue ? `${warehouseAvailable.toFixed(2)} -> ${warehouseRemaining.toFixed(2)}` : '',
      remainingQty: productValue && warehouseValue ? `${totalAvailable.toFixed(2)} -> ${metrics.totalRemainingAfter.toFixed(2)}` : '',
      availabilityStatus: productValue && warehouseValue ? getStockStatus(metrics.warehouseRemainingAfter, reorderLevel) : '',
    };
  };
  if (setupNotice) {
    return setupNotice;
  }

  return <LazyModuleBoundary><InvoiceTemplate title={title} statusText={statusText} storageKey={storageKey} moduleId={moduleId} taxMode={taxMode} requirePartyTaxIds={requirePartyTaxIds} serialPrefix={serialPrefix} showTaxSummary={showTaxSummary} headerRows={salesTaxHeaderRows} partyFields={partyFields} itemColumns={cols} costCentres={costCentreNames} warehouses={warehouseNames} showWarehouse={false} useHeaderWarehouseAsRowDefault={false} autoFillRate autoApplyFurtherTax furtherTaxRate={furtherTaxRate} decorateRow={decorateRow} validateBeforeSave={validateRowsAgainstAvailability} /></LazyModuleBoundary>;
};

const DynVendorPayment: React.FC<{ title: string; statusText?: string; modeValue?: string; storageKey?: string; withTax?: boolean; moduleId?: string }> = ({ title, statusText, modeValue, storageKey, withTax, moduleId }) => {
  const vendorOpts = useVendorOptions(true);
  if (vendorOpts.length <= 1) {
    return <SetupRequiredNotice title={`${title} is not ready yet`} message="Create at least one vendor before using this module." />;
  }
  const partyFields = [{ label: 'Vendor', type: 'select' as const, options: vendorOpts }, { label: 'Name' }, { label: 'Address' }, ...(withTax ? [{ label: 'N.T.N.' }, { label: 'S.T.R.N.' }] : [])];
  const detailColumns = withTax
    ? [{ key: 'refNo', label: 'Reference No' }, { key: 'refDate', label: 'Reference Date' }, { key: 'gross', label: 'Gross Amount', type: 'number' as const }, { key: 'whtPct', label: 'WHT %', type: 'number' as const }, { key: 'whtAmt', label: 'WHT Amount', type: 'number' as const }, { key: 'net', label: 'Net Payment', type: 'number' as const }]
    : [{ key: 'refNo', label: 'Reference No' }, { key: 'refDate', label: 'Reference Date' }, { key: 'gross', label: 'Gross Amount', type: 'number' as const }, { key: 'net', label: 'Net Payment', type: 'number' as const }];
  return <LazyModuleBoundary><PaymentReceiptTemplate title={title} statusText={statusText} modeValue={modeValue} storageKey={storageKey} moduleId={moduleId} partyFields={partyFields} tableTitle={withTax ? 'Tax Payment Details' : 'Payment Details'} detailColumns={detailColumns} totalLabel="Total Payment" /></LazyModuleBoundary>;
};

const DynAccountPayment: React.FC<{ title: string; statusText?: string; modeValue?: string; storageKey?: string; withTax?: boolean; moduleId?: string }> = ({ title, statusText, modeValue, storageKey, withTax, moduleId }) => {
  const accountOpts = useAccountOptions(true);
  if (accountOpts.length <= 1) {
    return <SetupRequiredNotice title={`${title} is not ready yet`} message="Create at least one chart of account entry before using this module." />;
  }
  const partyFields = [{ label: 'Account', type: 'select' as const, options: accountOpts }, { label: 'Name' }, { label: 'Address' }];
  const detailColumns = withTax
    ? [{ key: 'refNo', label: 'Reference No' }, { key: 'refDate', label: 'Reference Date' }, { key: 'gross', label: 'Gross Amount', type: 'number' as const }, { key: 'whtPct', label: 'WHT %', type: 'number' as const }, { key: 'whtAmt', label: 'WHT Amount', type: 'number' as const }, { key: 'net', label: 'Net Payment', type: 'number' as const }]
    : [{ key: 'refNo', label: 'Reference No' }, { key: 'refDate', label: 'Reference Date' }, { key: 'gross', label: 'Gross Amount', type: 'number' as const }, { key: 'net', label: 'Net Payment', type: 'number' as const }];
  return <LazyModuleBoundary><PaymentReceiptTemplate title={title} statusText={statusText} modeValue={modeValue} storageKey={storageKey} moduleId={moduleId} partyFields={partyFields} tableTitle="Payment Details" detailColumns={detailColumns} totalLabel="Total Payment" /></LazyModuleBoundary>;
};

const DynReceipt: React.FC = () => {
  const customerOpts = useCustomerOptions(true);
  if (customerOpts.length <= 1) {
    return <SetupRequiredNotice title="Bank / Cash Receipts is not ready yet" message="Create at least one customer before using this module." />;
  }
  return <LazyModuleBoundary><PaymentReceiptTemplate title="Bank / Cash Receipts" modeLabel="Receipt Mode" modeType="select" modeOptions={['Cash', 'Bank', 'Cheque']} storageKey="bank-cash-receipts" moduleId="receipts-bank-cash-receipts" partyFields={[{ label: 'Customer', type: 'select' as const, options: customerOpts }, { label: 'Name' }, { label: 'Address' }, { label: 'Contact' }]} tableTitle="Receipt Details" detailColumns={[{ key: 'invNo', label: 'Invoice No' }, { key: 'invDate', label: 'Invoice Date' }, { key: 'invAmt', label: 'Invoice Amount', type: 'number' as const }, { key: 'receipt', label: 'Receipt', type: 'number' as const }]} totalLabel="Total Receipt" /></LazyModuleBoundary>;
};

const DynPDCIssued: React.FC = () => {
  const vendorOpts = useVendorOptions(true);
  if (vendorOpts.length <= 1) {
    return <SetupRequiredNotice title="Post Dated Cheques Issued is not ready yet" message="Create at least one vendor before using this module." />;
  }
  return <LazyModuleBoundary><PaymentReceiptTemplate title="Post Dated Cheques Issued" statusText="POST DATED CHEQUE &bull; Storage: pdc-issued" modeValue="Cheque" storageKey="pdc-issued" moduleId="payments-non-tax-post-dated-cheques-issued" partyFields={[{ label: 'Vendor', type: 'select' as const, options: vendorOpts }, { label: 'Name' }, { label: 'Address' }]} tableTitle="Cheque Details" detailColumns={[{ key: 'chequeNo', label: 'Cheque No' }, { key: 'chequeDate', label: 'Cheque Date' }, { key: 'amount', label: 'Amount', type: 'number' as const }]} totalLabel="Total Amount" /></LazyModuleBoundary>;
};

const DynJournal: React.FC = () => {
  const accountOpts = useAccountOptions();
  const costCentreOpts = useCostCentreOptions();
  if (accountOpts.length <= 1) {
    return <SetupRequiredNotice title="Journal Vouchers is not ready yet" message="Initialize the chart of accounts and create at least one account before using this module." />;
  }
  return <LazyModuleBoundary><JournalAdjustmentTemplate title="Journal Vouchers" storageKey="journal-vouchers" moduleId="adjustments-journal-vouchers" inlineFields={[{ label: 'Serial', type: 'number', value: 1 }, { label: 'Date', type: 'text' }, { label: 'Status', type: 'select', options: ['Processed', 'Authorized'] }, { label: 'Documents', type: 'display', value: '0' }]} columns={[{ key: 'account', label: 'Account', type: 'select' as const, options: accountOpts }, { key: 'costCentre', label: 'Cost Centre', type: 'select' as const, options: costCentreOpts }, { key: 'debit', label: 'Debit', type: 'number' as const }, { key: 'credit', label: 'Credit', type: 'number' as const }, { key: 'remarks', label: 'Remarks', type: 'text' as const }]} bottomLabel="Narration" /></LazyModuleBoundary>;
};

const DynStockModule: React.FC<{ title: string; storageKey?: string; extraFields?: any[]; moduleId?: string }> = ({ title, storageKey, extraFields, moduleId }) => {
  const productOpts = useProductOptions(true);
  const warehouseOpts = useWarehouseOptions();
  const prefs = usePreferences();
  const inventoryBalances = useInventoryBalances();
  const latestBomMap = useLatestBOMMap();
  const hasProducts = productOpts.length > 1;
  const hasWarehouses = warehouseOpts.length > 1;
  const setupNotice = (!hasProducts || !hasWarehouses)
    ? (
      <SetupRequiredNotice
        title={`${title} is not ready yet`}
        message="Create at least one product and one warehouse before using this module."
      />
    )
    : null;

  const firstRealWarehouse = warehouseOpts.find(option => String(option.value || '').trim() !== '');
  const defaultWarehouse = String(prefs.defaultWarehouse || firstRealWarehouse?.value || '');
  const qtyPrecision = Number(prefs.qtyDec ?? 2);
  const ratePrecision = Number(prefs.rateDec ?? 2);
  const qtyProductionPrecision = Number(prefs.qtyProd ?? 6);
  const rateProductionPrecision = Number(prefs.rateProd ?? 6);
  const isTransfer = storageKey === 'store-inventory-transfers';
  const isDeliveryLike = storageKey === 'store-delivery-notes' || storageKey === 'store-outwards-gate-passes';
  const isBom = storageKey === 'store-bill-of-materials';
  const isMaterialIssue = storageKey === 'store-material-issue-notes';
  const isProductionNote = storageKey === 'store-production-notes';
  const isAssembly = storageKey === 'store-production-assembly';
  const isInternalIssue = storageKey === 'store-material-issue-notes' || storageKey === 'store-production-notes' || storageKey === 'store-production-assembly' || storageKey === 'store-bill-of-materials';
  const isProductionDocument = isBom || isMaterialIssue || isProductionNote || isAssembly;
  const isOutboundStock = isTransfer || isDeliveryLike || storageKey === 'store-reduce-inventory' || isMaterialIssue;
  const numberPrecision = isProductionDocument
    ? { qty: qtyProductionPrecision, rate: rateProductionPrecision, amount: Math.max(2, rateProductionPrecision) }
    : { qty: qtyPrecision, rate: ratePrecision, amount: Math.max(2, ratePrecision) };
  const getProductDetails = (productValue: string) => (productOpts.find(option => option.value === productValue) as any)?.details;
  const getRelatedStockKeys = React.useCallback((productValue: string) => {
    const normalized = String(productValue || '').trim().toLowerCase();
    if (!normalized) return [];

    const optionsWithDetails = productOpts.filter((option: any) => String(option.value || '').trim() && option.details);
    const directOption = optionsWithDetails.find((option: any) => String(option.value || '').trim().toLowerCase() === normalized)
      || optionsWithDetails.find((option: any) => String(option.details?.name || '').trim().toLowerCase() === normalized);
    if (!directOption) {
      return [String(productValue || '').trim()].filter(Boolean);
    }
    const directOptionDetails = (directOption as any).details || {};

    const targetName = String(directOptionDetails.name || '').trim().toLowerCase();
    const targetCode = String(directOptionDetails.code || directOptionDetails.id || '').trim().toLowerCase();
    const keys = new Set<string>();
    optionsWithDetails.forEach((option: any) => {
      const optionCode = String(option.details?.code || option.details?.id || '').trim().toLowerCase();
      const optionName = String(option.details?.name || '').trim().toLowerCase();
      if ((targetCode && optionCode && optionCode === targetCode) || (targetName && optionName && optionName === targetName)) {
        const key = String(option.value || '').trim();
        if (key) keys.add(key);
      }
    });

    if (keys.size === 0) {
      const fallback = String(directOption.value || productValue || '').trim();
      if (fallback) keys.add(fallback);
    }

    return Array.from(keys);
  }, [productOpts]);
  const getAvailableQty = (productValue: string, warehouseValue: string) => {
    if (!productValue || !warehouseValue) return '';
    const relatedKeys = getRelatedStockKeys(productValue);
    const available = (relatedKeys.length > 0 ? relatedKeys : [productValue]).reduce((sum, key) => (
      sum + inventoryBalances.getAvailableQty(key, warehouseValue)
    ), 0);
    return Math.max(0, available).toFixed(numberPrecision.qty);
  };
  const getAvailabilityStatus = (productValue: string, warehouseValue: string) => {
    if (!productValue || !warehouseValue) return '';
    const details = getProductDetails(productValue);
    const relatedKeys = getRelatedStockKeys(productValue);
    const available = (relatedKeys.length > 0 ? relatedKeys : [productValue]).reduce((sum, key) => (
      sum + inventoryBalances.getAvailableQty(key, warehouseValue)
    ), 0);
    const reorderLevel = Number(details?.reorderLevel || details?.reorder || 20);
    return getStockStatus(available, reorderLevel);
  };
  const stockCols = [
    { key: 'product', label: isInternalIssue ? 'Item' : 'Product', type: 'select' as const, options: productOpts },
    ...(isTransfer
      ? [
          { key: 'fromWarehouse', label: 'From Warehouse', type: 'select' as const, options: warehouseOpts, defaultValue: defaultWarehouse },
          { key: 'toWarehouse', label: 'To Warehouse', type: 'select' as const, options: warehouseOpts, defaultValue: '' },
        ]
      : [
          { key: 'warehouse', label: 'Warehouse', type: 'select' as const, options: warehouseOpts, defaultValue: defaultWarehouse },
        ]),
    { key: 'availableQty', label: 'Available', type: 'text' as const, defaultValue: '', readOnly: true },
    { key: 'availabilityStatus', label: 'Stock Status', type: 'text' as const, defaultValue: '', readOnly: true, displayAsBadge: true, inputClassName: (row: Record<string, any>) => getStatusBadgeClass(String(row.availabilityStatus || '')) },
    { key: 'qty', label: 'Qty', type: 'number' as const, defaultValue: 0 },
    { key: 'unit', label: 'Unit', type: 'text' as const, defaultValue: 'Pcs' },
    { key: 'rate', label: 'Rate', type: 'number' as const, defaultValue: 0 },
    { key: 'amount', label: 'Amount', type: 'number' as const, defaultValue: 0, readOnly: true },
    { key: 'reason', label: 'Reason', type: 'text' as const },
  ];
  const productionInlineFields = isBom || isProductionNote || isAssembly
    ? [
        { key: 'finishedProduct', label: isBom ? 'Finished Product' : 'Produced Item', type: 'select', options: productOpts },
        { key: 'outputQty', label: isBom ? 'Yield Qty' : 'Output Qty', type: 'number', value: 0 },
        { key: 'outputUnit', label: 'Output Unit', type: 'text', value: '', readOnly: true },
        ...(!isBom ? [{ key: 'outputWarehouse', label: 'Output Warehouse', type: 'select', options: warehouseOpts, value: defaultWarehouse }] : []),
      ]
    : isMaterialIssue
      ? [
          { key: 'issueFor', label: 'Issue For', type: 'select', options: productOpts },
          { key: 'issueUnit', label: 'Issue Unit', type: 'text', value: '', readOnly: true },
        ]
      : [];
  const inlineFields = [
    { key: 'serial', label: 'Serial', type: 'number', value: 1 },
    { key: 'date', label: 'Date', type: 'text' },
    ...productionInlineFields,
    ...(extraFields || []),
    { key: 'status', label: 'Status', type: 'select', options: ['Processed', 'Authorized'] },
    { key: 'documents', label: 'Documents', type: 'display' },
  ];
  const handleStockRowChange = (row: Record<string, any>, key: string) => {
    const sourceWarehouse = isTransfer ? String(row.fromWarehouse || '') : String(row.warehouse || '');
    const nextRow = {
      ...row,
      availableQty: getAvailableQty(String(row.product || ''), sourceWarehouse),
      availabilityStatus: getAvailabilityStatus(String(row.product || ''), sourceWarehouse),
    };

    if (key !== 'product') return nextRow;

    const details = getProductDetails(row.product);
    if (!details) return nextRow;

    const defaultRate = isDeliveryLike
      ? Number(details.salePrice || details.price1 || details.cost || details.costPrice || 0)
      : Number(details.cost || details.costPrice || details.price1 || details.salePrice || 0);

    return {
      ...nextRow,
      unit: details.unit || row.unit || 'Pcs',
      rate: defaultRate,
    };
  };

  const handleInlineChange = (inlineState: Record<string, any>, key: string, _value: any, rows: Record<string, any>[]) => {
    if (key === 'finishedProduct') {
      const details = getProductDetails(String(inlineState.finishedProduct || ''));
      const nextInlineState = {
        ...inlineState,
        outputUnit: details?.unit || '',
        ...((isProductionNote || isAssembly) && !inlineState.outputWarehouse ? { outputWarehouse: defaultWarehouse } : {}),
      };

      if (isProductionNote || isAssembly) {
        const bomRecord = latestBomMap.get(String(inlineState.finishedProduct || ''));
        if (bomRecord) {
          const bomRows: Record<string, any>[] = (bomRecord.rows || []).map((row: Record<string, any>) => {
            const productDetails = getProductDetails(String(row.product || ''));
            const rate = Number(row.rate || productDetails?.cost || productDetails?.costPrice || productDetails?.price1 || 0);
            const qty = toNumber(row.qty);
            return {
              ...row,
              warehouse: row.warehouse || defaultWarehouse,
              unit: row.unit || productDetails?.unit || 'Pcs',
              rate,
              amount: qty * rate,
            };
          });
          const hydratedBomRows: Record<string, any>[] = bomRows.map(entry => ({
            ...entry,
            availableQty: getAvailableQty(String(entry.product || ''), String(entry.warehouse || defaultWarehouse)),
            availabilityStatus: getAvailabilityStatus(String(entry.product || ''), String(entry.warehouse || defaultWarehouse)),
          }));
          return {
            inlineState: {
              ...nextInlineState,
              outputQty: toNumber(inlineState.outputQty) > 0 ? inlineState.outputQty : getInlineValue(bomRecord, 'outputQty', 'Yield Qty', 'Output Qty') || 0,
            },
            rows: hydratedBomRows.length > 0 ? hydratedBomRows : rows,
          };
        }
      }

      return nextInlineState;
    }
    if (key === 'issueFor') {
      const details = getProductDetails(String(inlineState.issueFor || ''));
      return {
        ...inlineState,
        issueUnit: details?.unit || '',
      };
    }
    return inlineState;
  };

  const validateStockRows = (rows: Record<string, any>[], inlineState: Record<string, any>, totals: Record<string, number>) => {
    if (isBom || isProductionNote || isAssembly) {
      if (!inlineState.finishedProduct) return 'Finished product is required.';
      if ((parseFloat(inlineState.outputQty) || 0) <= 0) return 'Output quantity must be greater than zero.';
      if ((totals.amount || 0) <= 0) return 'Component cost must be greater than zero.';
      if ((isProductionNote || isAssembly) && !inlineState.outputWarehouse) return 'Output warehouse is required.';
    }
    if (isMaterialIssue && !inlineState.issueFor) {
      return 'Issue for product is required.';
    }

    const outboundDemand = new Map<string, number>();
    const documentDelta = new Map<string, number>();
    const normalizeStockKeyPart = (value: unknown) => String(value || '').trim();
    const getProductDemandGroupKey = (productInput: string) => {
      const fallback = normalizeStockKeyPart(productInput);
      const relatedKeys = getRelatedStockKeys(productInput).map(key => normalizeStockKeyPart(key)).filter(Boolean);
      if (relatedKeys.length === 0) {
        return fallback;
      }
      return Array.from(new Set(relatedKeys)).sort().join('|');
    };

    const reserveStock = (productInput: string, warehouseInput: string, qty: number) => {
      const product = normalizeStockKeyPart(productInput);
      const warehouse = normalizeStockKeyPart(warehouseInput);
      if (!product || !warehouse || qty <= 0) return null;
      const relatedKeys = getRelatedStockKeys(product);
      const groupKey = getProductDemandGroupKey(product);
      const demandKey = movementKey(groupKey, warehouse);
      const demanded = (outboundDemand.get(demandKey) || 0) + qty;
      outboundDemand.set(demandKey, demanded);
      const available = (relatedKeys.length > 0 ? relatedKeys : [product]).reduce((sum, key) => (
        sum + inventoryBalances.getAvailableQty(key, warehouse)
      ), 0);
      if (available + 1e-9 < demanded) {
        return `Insufficient stock for ${product} in ${warehouse}. Available: ${Math.max(0, available).toFixed(numberPrecision.qty)}, required: ${demanded.toFixed(numberPrecision.qty)}.`;
      }
      return null;
    };

    const reserveTransferStock = (productInput: string, fromWarehouseInput: string, toWarehouseInput: string, qty: number) => {
      const product = normalizeStockKeyPart(productInput);
      const fromWarehouse = normalizeStockKeyPart(fromWarehouseInput);
      const toWarehouse = normalizeStockKeyPart(toWarehouseInput);
      if (!product || !fromWarehouse || !toWarehouse || qty <= 0) return null;

      const relatedKeys = getRelatedStockKeys(product);
      const groupKey = getProductDemandGroupKey(product);
      const fromKey = movementKey(groupKey, fromWarehouse);
      const toKey = movementKey(groupKey, toWarehouse);
      const baseAvailable = (relatedKeys.length > 0 ? relatedKeys : [product]).reduce((sum, key) => (
        sum + inventoryBalances.getAvailableQty(key, fromWarehouse)
      ), 0);
      const projectedBeforeRow = baseAvailable + (documentDelta.get(fromKey) || 0);
      if (projectedBeforeRow + 1e-9 < qty) {
        return `Insufficient stock for ${product} in ${fromWarehouse}. Available: ${Math.max(0, projectedBeforeRow).toFixed(numberPrecision.qty)}, required: ${qty.toFixed(numberPrecision.qty)}.`;
      }

      documentDelta.set(fromKey, (documentDelta.get(fromKey) || 0) - qty);
      documentDelta.set(toKey, (documentDelta.get(toKey) || 0) + qty);
      return null;
    };

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowNumber = index + 1;
      if (!row.product) return `Row ${rowNumber}: product is required.`;
      if ((parseFloat(row.qty) || 0) <= 0) return `Row ${rowNumber}: quantity must be greater than zero.`;
      if ((isBom || isProductionNote || isAssembly) && row.product === inlineState.finishedProduct) {
        return `Row ${rowNumber}: component item must be different from the finished product.`;
      }
      if (isTransfer) {
        if (!row.fromWarehouse) return `Row ${rowNumber}: source warehouse is required.`;
        if (!row.toWarehouse) return `Row ${rowNumber}: destination warehouse is required.`;
        if (row.fromWarehouse === row.toWarehouse) return `Row ${rowNumber}: source and destination warehouses must be different.`;
        const transferStockError = reserveTransferStock(row.product, row.fromWarehouse, row.toWarehouse, toNumber(row.qty));
        if (transferStockError) return transferStockError;
      } else if (!row.warehouse) {
        return `Row ${rowNumber}: warehouse is required.`;
      } else if (isOutboundStock || isProductionNote || isAssembly) {
        const stockError = reserveStock(row.product, row.warehouse, toNumber(row.qty));
        if (stockError) return stockError;
      }
    }
    return null;
  };

  const summaryFields = isBom || isProductionNote || isAssembly
    ? [
        {
          label: 'Total Component Qty',
          value: (_rows: Record<string, any>[], _inlineState: Record<string, any>, totals: Record<string, number>) => Number(totals.qty || 0).toFixed(numberPrecision.qty),
        },
        {
          label: 'Total Component Cost',
          value: (_rows: Record<string, any>[], _inlineState: Record<string, any>, totals: Record<string, number>) => Number(totals.amount || 0).toFixed(numberPrecision.amount),
        },
        {
          label: 'Unit Cost',
          value: (_rows: Record<string, any>[], inlineState: Record<string, any>, totals: Record<string, number>) => {
            const outputQty = parseFloat(inlineState.outputQty) || 0;
            const unitCost = outputQty > 0 ? (totals.amount || 0) / outputQty : 0;
            return unitCost.toFixed(numberPrecision.rate);
          },
        },
      ]
    : isMaterialIssue
      ? [
          {
            label: 'Total Issue Qty',
            value: (_rows: Record<string, any>[], _inlineState: Record<string, any>, totals: Record<string, number>) => Number(totals.qty || 0).toFixed(numberPrecision.qty),
          },
          {
            label: 'Total Issue Cost',
            value: (_rows: Record<string, any>[], _inlineState: Record<string, any>, totals: Record<string, number>) => Number(totals.amount || 0).toFixed(numberPrecision.amount),
          },
        ]
      : [];

  if (setupNotice) {
    return setupNotice;
  }

  return <LazyModuleBoundary><JournalAdjustmentTemplate title={title} storageKey={storageKey} moduleId={moduleId} inlineFields={inlineFields} columns={stockCols} bottomLabel="Remarks" onRowChange={handleStockRowChange} onInlineChange={handleInlineChange} validateRows={validateStockRows} summaryFields={summaryFields} numberPrecision={numberPrecision} /></LazyModuleBoundary>;
};


const CompanySetupModule = () => {
  const store = useData();
  const { toast } = useToast();
  const records = useCollection('company-setup');
  const taxRates = useCollection('tax-rates');
  const defaults: Record<string, string> = { companyName: '', address: '', phone: '', email: '', website: '', nick: '', ntn: '', strn: '' };
  const saved = records[0] || {};
  const [form, setForm] = React.useState<Record<string, string>>(() => ({ ...defaults, ...saved }));
  const logoInputRef = React.useRef<HTMLInputElement | null>(null);
  const f = (key: string) => form[key] ?? defaults[key] ?? '';
  const set = (key: string, val: string) => setForm(p => ({ ...p, [key]: val }));
  const logoSrc = resolveCompanyLogoSrc(form, '');

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file for the company logo', 'error');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        toast('Unable to read the selected logo file', 'error');
        return;
      }
      setForm(previous => ({ ...previous, companyLogo: result }));
      toast('Company logo selected. Save changes to apply it everywhere.', 'info');
    };
    reader.onerror = () => {
      toast('Unable to read the selected logo file', 'error');
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleRemoveLogo = () => {
    setForm(previous => ({ ...previous, companyLogo: '' }));
    if (logoInputRef.current) {
      logoInputRef.current.value = '';
    }
    toast('Company logo removed. Save changes to update documents.', 'info');
  };

  const handleSave = () => {
    if (saved.id) { store.update('company-setup', saved.id, form); } else { store.add('company-setup', form); }
    toast('Company setup saved');
  };
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-accent-cyan font-bold text-xl">COMPANY SETUP</h2>
        <button onClick={handleSave} className="px-4 py-1.5 bg-accent-teal text-white text-xs font-bold hover:brightness-110">Save Changes</button>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-accent-teal font-bold text-sm mb-3">Basic Info</div>
          <div className="space-y-2">
            <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Company / Branch Name</span><input className="flex-1 text-xs" type="text" value={f('companyName')} onChange={e => set('companyName', e.target.value)} /></div>
            <div className="flex items-start gap-2"><span className="text-xs text-text-secondary w-32 pt-1">Address</span><textarea className="flex-1 text-xs h-12 resize-none" value={f('address')} onChange={e => set('address', e.target.value)} /></div>
            <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Phone(s)</span><input className="flex-1 text-xs" type="text" value={f('phone')} onChange={e => set('phone', e.target.value)} /></div>
            <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">E-Mail</span><input className="flex-1 text-xs" type="text" value={f('email')} onChange={e => set('email', e.target.value)} /></div>
            <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Website</span><input className="flex-1 text-xs" type="text" value={f('website')} onChange={e => set('website', e.target.value)} /></div>
            <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Company / Branch Nick</span><input className="flex-1 text-xs" type="text" value={f('nick')} onChange={e => set('nick', e.target.value)} /></div>
          </div>
        </div>
        <div>
          <div className="text-accent-teal font-bold text-sm mb-3">Company Logo</div>
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 bg-white border border-border-custom flex items-center justify-center mb-2">
              {logoSrc ? (
                <img src={logoSrc} alt="Company logo preview" className="w-full h-full object-contain p-2" />
              ) : (
                <div className="w-16 h-16 bg-[#1e88e5] rounded-full flex items-center justify-center"><span className="text-white text-2xl font-bold">A</span></div>
              )}
            </div>
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            <div className="flex gap-2">
              <button type="button" onClick={() => logoInputRef.current?.click()} className="px-3 py-1 bg-bg-tertiary border border-border-custom text-xs hover:bg-bg-secondary">
                {logoSrc ? 'Change Logo' : 'Set New Logo'}
              </button>
              <button type="button" onClick={handleRemoveLogo} className="px-3 py-1 bg-bg-tertiary border border-border-custom text-xs hover:bg-bg-secondary" disabled={!logoSrc}>
                Remove
              </button>
            </div>
            <p className="text-xs text-text-secondary mt-2 text-center">(Recommended size for logo is 100 x 100 px)</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-accent-teal font-bold text-sm mb-3">Federal Tax Info</div>
          <div className="space-y-2">
            <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-40">National Tax No. (N.T.N.)</span><input className="flex-1 text-xs" type="text" value={f('ntn')} onChange={e => set('ntn', e.target.value)} /></div>
            <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-40">Sales Tax Regn. No.</span><input className="flex-1 text-xs" type="text" value={f('strn')} onChange={e => set('strn', e.target.value)} /></div>
          </div>
        </div>
        <div>
          <div className="text-accent-teal font-bold text-sm mb-3">State / Provincial Tax Info</div>
          <div className="border border-border-custom">
            <table className="w-full">
              <thead><tr className="bg-bg-tertiary">
                <th className="text-xs py-1 px-2 border border-border-custom text-white">State / Province</th>
                <th className="text-xs py-1 px-2 border border-border-custom text-white">Tax Registration No.</th>
              </tr></thead>
              <tbody>
                {taxRates.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="text-xs py-3 px-2 border border-border-custom text-text-secondary text-center">No state or province tax rows configured yet.</td>
                  </tr>
                ) : taxRates.map((row, index) => {
                  const stateName = String(row.name || '').trim();
                  const fieldKey = `tax-${String(row.id || index)}`;
                  return (
                    <tr key={String(row.id || fieldKey)} className={index % 2 === 0 ? 'bg-bg-secondary' : 'bg-bg-primary'}>
                      <td className="text-xs py-1 px-2 border border-border-custom text-text-primary">{stateName}</td>
                      <td className="text-xs py-1 px-2 border border-border-custom">
                        <input className="w-full text-xs bg-transparent" type="text" value={f(fieldKey)} onChange={e => set(fieldKey, e.target.value)} placeholder="" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

const UserLoginsModule = () => {
  const store = useData();
  const { toast } = useToast();
  const users = useCollection('user-logins');
  const { currentUser } = useSession();
  const sessionUser = currentUser || readSessionUser();
  const normalizedSessionRole = String(sessionUser?.role || '').trim().toLowerCase();
  const isPlatformOwner = normalizedSessionRole === 'platform owner';
  const defaultCloudRole = isPlatformOwner ? 'Client Admin' : 'Operator';
  const [form, setForm] = React.useState({ fullName: '', username: '', password: '', email: '', organizationName: '', role: isCloudModeEnabled ? defaultCloudRole : 'Operator', status: 'Active', includeDemoData: false });
  const [selId, setSelId] = React.useState<string | null>(null);
  const [showPw, setShowPw] = React.useState(false);
  const [busyAction, setBusyAction] = React.useState<'save' | 'reset' | 'delete' | 'prepare' | 'clear' | null>(null);
  const isEditing = Boolean(selId);
  const isBusy = busyAction !== null;
  const roleOptions = React.useMemo(() => {
    if (!isCloudModeEnabled) {
      return ['Super Admin', 'Manager', 'Accountant', 'Operator', 'Viewer'];
    }

    return isPlatformOwner ? ['Client Admin'] : ['Manager', 'Accountant', 'Operator', 'Viewer'];
  }, [isPlatformOwner]);

  const visibleUsers = React.useMemo(() => {
    if (!isCloudModeEnabled || !isPlatformOwner) {
      return users;
    }

    return users.filter(user => String(user.role || '').trim().toLowerCase() === 'client admin');
  }, [isPlatformOwner, users]);

  React.useEffect(() => {
    if (!isCloudModeEnabled && users.length === 0) {
      [{ fullName: 'Administrator', username: 'admin', password: 'admin', email: 'admin@company.com', role: 'Super Admin', status: 'Active' },
       { fullName: 'Manager', username: 'manager', password: 'manager', email: 'manager@company.com', role: 'Manager', status: 'Active' },
       { fullName: 'Accountant', username: 'accountant', password: 'accountant', email: 'accountant@company.com', role: 'Accountant', status: 'Active' },
       { fullName: 'Operator', username: 'operator', password: 'operator', email: 'operator@company.com', role: 'Operator', status: 'Inactive' }].forEach(u => store.add('user-logins', u));
    }
  }, [store, users.length]);

  const selectedUserRecord = React.useMemo(() => {
    if (!selId) {
      return null;
    }

    return visibleUsers.find(user => String(user.id || '') === String(selId)) || null;
  }, [selId, visibleUsers]);

  React.useEffect(() => {
    if (!selId) {
      return;
    }

    const selectedStillVisible = visibleUsers.some(user => String(user.id || '') === String(selId));
    if (!selectedStillVisible) {
      setSelId(null);
      setForm({ fullName: '', username: '', password: '', email: '', organizationName: '', role: isCloudModeEnabled ? defaultCloudRole : 'Operator', status: 'Active', includeDemoData: false });
    }
  }, [defaultCloudRole, selId, visibleUsers]);

  const handleAdd = () => { setSelId(null); setForm({ fullName: '', username: '', password: '', email: '', organizationName: '', role: isCloudModeEnabled ? defaultCloudRole : 'Operator', status: 'Active', includeDemoData: false }); };
  const handleResetPassword = async () => {
    if (!selId) { toast('Select a user first', 'error'); return; }
    if (form.password.length < 6) { toast('Enter a new password with at least 6 characters', 'error'); return; }

    if (isCloudModeEnabled) {
      try {
        setBusyAction('reset');
        const refreshedUsers = await updateCloudUser({ id: selId, ...form, password: form.password });
        store.replaceAll('user-logins', refreshedUsers);
        toast(`Password reset for ${form.username}`);
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Unable to reset password', 'error');
        return;
      } finally {
        setBusyAction(null);
      }
    } else {
      store.update('user-logins', selId, { password: form.password });
      toast(`Password reset for ${form.username}`);
    }

    setForm((current) => ({ ...current, password: '' }));
  };
  const handleSave = async () => {
    if (!form.username || !form.fullName) { toast('Name & username required', 'error'); return; }
    if (isCloudModeEnabled && isPlatformOwner && form.role !== 'Client Admin') { toast('Platform owner can only create client admin accounts', 'error'); return; }
    const normalizedUsername = normalizeLoginUsername(form.username);
    const originalUsername = normalizeLoginUsername(selectedUserRecord?.username);
    const usernameChanged = normalizedUsername !== originalUsername;
    const localConflict = users.some(user => String(user.id || '') !== String(selId || '') && normalizeLoginUsername(user.username) === normalizedUsername);

    if (localConflict) {
      toast('Username already taken', 'error');
      return;
    }

    if (isCloudModeEnabled) {
      if (!selId && form.password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
      if (isPlatformOwner && form.role === 'Client Admin' && !form.organizationName.trim()) { toast('Business name is required for client admins', 'error'); return; }

      if (usernameChanged) {
        try {
          const availability = await checkCloudUsernameAvailability(form.username);
          if (!availability.available) {
            toast('Username already taken', 'error');
            return;
          }
        } catch (error) {
          toast(error instanceof Error ? error.message : 'Unable to verify username availability', 'error');
          return;
        }
      }

      try {
        setBusyAction('save');
        const refreshedUsers = selId
          ? await updateCloudUser({ id: selId, ...form, password: form.password || undefined })
          : await createCloudUser(form);
        store.replaceAll('user-logins', refreshedUsers);
        toast(selId ? 'User updated' : 'User added');
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Unable to save user', 'error');
        return;
      } finally {
        setBusyAction(null);
      }
    } else if (selId) {
      store.update('user-logins', selId, form);
      toast('User updated');
    } else {
      store.add('user-logins', form);
      toast('User added');
    }
    setSelId(null); setForm({ fullName: '', username: '', password: '', email: '', organizationName: '', role: isCloudModeEnabled ? defaultCloudRole : 'Operator', status: 'Active', includeDemoData: false });
  };
  const handleDelete = async () => {
    if (!selId) { toast('Select a user first', 'error'); return; }
    if (isCloudModeEnabled) {
      try {
        setBusyAction('delete');
        const refreshedUsers = await deleteCloudUser(selId);
        store.replaceAll('user-logins', refreshedUsers);
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Unable to delete user', 'error');
        return;
      } finally {
        setBusyAction(null);
      }
    } else {
      store.remove('user-logins', selId);
    }
    setSelId(null); setForm({ fullName: '', username: '', password: '', email: '', organizationName: '', role: isCloudModeEnabled ? defaultCloudRole : 'Operator', status: 'Active', includeDemoData: false }); toast('User deleted');
  };
  const handlePrepareWorkspace = async () => {
    if (!isCloudModeEnabled) { return; }
    const targetOrganizationName = form.organizationName.trim();
    if (!targetOrganizationName) { toast('Select a client business first', 'error'); return; }

    try {
      setBusyAction('prepare');
      await prepareCloudWorkspace(targetOrganizationName, undefined, form.includeDemoData);
      const message = form.includeDemoData 
        ? `Workspace prepared with demo data for ${targetOrganizationName}`
        : `Workspace prepared (clean) for ${targetOrganizationName}`;
      toast(message);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to prepare workspace', 'error');
      return;
    } finally {
      setBusyAction(null);
    }
  };
  const handleClearDemoData = async () => {
    if (!isCloudModeEnabled || !isPlatformOwner) { 
      toast('Only platform owner can clear demo data', 'error'); 
      return; 
    }
    const targetOrganizationName = form.organizationName.trim();
    if (!targetOrganizationName) { 
      toast('Select a client business first', 'error'); 
      return; 
    }

    const confirmed = window.confirm(
      `WARNING: This will delete ALL demo data (vendors, customers, products, transactions) for "${targetOrganizationName}".\n\n` +
      `The following will be preserved:\n` +
      `- User accounts and rights\n` +
      `- Company settings\n` +
      `- Financial years\n` +
      `- Essential preferences\n\n` +
      `This action cannot be undone. Continue?`
    );
    
    if (!confirmed) return;

    try {
      setBusyAction('clear');
      await clearCloudWorkspaceData(undefined, targetOrganizationName, true);
      toast(`Demo data cleared for ${targetOrganizationName}. Workspace is now clean.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to clear demo data', 'error');
      return;
    } finally {
      setBusyAction(null);
    }
  };
  const selectRow = (u: Record<string, unknown>) => { setSelId(u.id as string); setForm({ fullName: (u.fullName as string) || '', username: (u.username as string) || '', password: '', email: (u.email as string) || '', organizationName: (u.organizationName as string) || '', role: (u.role as string) || (isCloudModeEnabled ? defaultCloudRole : 'Operator'), status: (u.status as string) || 'Active', includeDemoData: false }); };
  const set = (key: string, val: string) => setForm(p => ({ ...p, [key]: val }));

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-4">
        <div className="bg-bg-tertiary border border-border-custom p-2 flex justify-between items-center">
          <h1 className="text-accent-orange font-bold text-xl">USER LOGINS</h1>
          <div className="flex gap-1">
            <button onClick={handleAdd} disabled={isBusy} className="p-2 bg-bg-secondary border border-border-custom hover:bg-bg-tertiary disabled:opacity-50" title="New"><svg className="w-5 h-5 text-[#2196f3]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5v14" /></svg></button>
            <button onClick={handleSave} disabled={isBusy} className="p-2 bg-bg-secondary border border-border-custom hover:bg-bg-tertiary disabled:opacity-50" title="Save"><svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg></button>
            {isCloudModeEnabled ? <button onClick={handlePrepareWorkspace} disabled={isBusy || !form.organizationName.trim()} className="p-2 bg-bg-secondary border border-border-custom hover:bg-bg-tertiary disabled:opacity-50" title="Prepare Workspace"><svg className="w-5 h-5 text-accent-orange" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 10h18" /><path d="M7 15h1m4 0h5" /><path d="M5 5h14l1 5H4l1-5Z" /><path d="M4 10v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /></svg></button> : null}
            {isCloudModeEnabled && isPlatformOwner ? <button onClick={handleClearDemoData} disabled={isBusy || !form.organizationName.trim()} className="p-2 bg-bg-secondary border border-border-custom hover:bg-bg-tertiary disabled:opacity-50" title="Clear Demo Data"><svg className="w-5 h-5 text-danger" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M10 11v6" /><path d="M14 11v6" /></svg></button> : null}
            <button onClick={handleResetPassword} disabled={isBusy} className="p-2 bg-bg-secondary border border-border-custom hover:bg-bg-tertiary disabled:opacity-50" title="Reset Password"><svg className="w-5 h-5 text-accent-cyan" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 10V7a4 4 0 10-8 0v3" /><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M12 14v2" /></svg></button>
            <button onClick={handleDelete} disabled={isBusy} className="p-2 bg-bg-secondary border border-border-custom hover:bg-bg-tertiary disabled:opacity-50" title="Delete"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10 11v6M14 11v6M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg></button>
          </div>
        </div>
        {isCloudModeEnabled && isPlatformOwner ? (
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="border border-border-custom bg-bg-secondary p-3">
              <div className="font-bold text-accent-cyan">Client Handover</div>
              <p className="mt-2 text-text-secondary">
                Create one client admin per business. Give the client only the username and password.
              </p>
            </div>
            <div className="border border-border-custom bg-bg-secondary p-3">
              <div className="font-bold text-accent-cyan">Business Scope</div>
              <p className="mt-2 text-text-secondary">
                A business record is created automatically when you add a new client admin with a business name.
              </p>
            </div>
            <div className="border border-border-custom bg-bg-secondary p-3">
              <div className="font-bold text-accent-cyan">Current Action</div>
              <p className="mt-2 text-text-secondary">
                {busyAction === 'save' ? 'Saving user account...' : busyAction === 'prepare' ? 'Preparing business workspace...' : busyAction === 'clear' ? 'Clearing demo data...' : busyAction === 'reset' ? 'Updating password...' : busyAction === 'delete' ? 'Removing user account...' : 'Ready'}
              </p>
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-bg-secondary border border-border-custom p-3">
            <div className="text-accent-teal font-bold text-sm mb-3">User Details</div>
            <div className="space-y-2">
              <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-28">Full Name</span><input className="flex-1 text-xs" type="text" value={form.fullName} onChange={e => set('fullName', e.target.value)} disabled={isBusy} /></div>
              <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-28">Username</span><input className="flex-1 text-xs text-accent-cyan" type="text" value={form.username} onChange={e => set('username', e.target.value)} disabled={isBusy} /></div>
              <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-28">{isCloudModeEnabled ? (isEditing ? 'New Password' : 'Password') : 'Password'}</span><div className="flex-1 relative"><input className="w-full text-xs pr-8" type={showPw ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)} placeholder={isCloudModeEnabled && isEditing ? 'Leave blank to keep current password' : ''} disabled={isBusy} /><button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-2 top-1/2 -translate-y-1/2" disabled={isBusy}><svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2.062 12.348a1 1 0 010-.696 10.75 10.75 0 0119.876 0 1 1 0 010 .696 10.75 10.75 0 01-19.876 0" /><circle cx="12" cy="12" r="3" /></svg></button></div></div>
              {isCloudModeEnabled
                ? (isPlatformOwner
                    ? <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-28">Login Handover</span><div className="flex-1 text-xs text-accent-cyan">Give client only User ID and Password. E-mail is managed internally.</div></div>
                    : null)
                : <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-28">E-Mail</span><input className="flex-1 text-xs" type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>}
              {isCloudModeEnabled ? <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-28">Business</span><input className="flex-1 text-xs" type="text" value={form.organizationName} onChange={e => set('organizationName', e.target.value)} placeholder={isPlatformOwner ? 'Required for client admin' : 'Assigned from your business'} disabled={!isPlatformOwner || isBusy} /></div> : null}
              {isCloudModeEnabled && isPlatformOwner ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary w-28">Demo Data</span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.includeDemoData}
                      onChange={e => setForm(p => ({ ...p, includeDemoData: e.target.checked }))}
                      disabled={isBusy}
                      className="w-4 h-4 accent-accent-teal"
                    />
                    <span className="text-xs text-text-secondary">
                      {form.includeDemoData ? 'Include sample vendors, customers, products, and transactions' : 'Start with clean workspace (no demo data)'}
                    </span>
                  </label>
                </div>
              ) : null}
              <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-28">Role</span><select className="flex-1 text-xs" value={form.role} onChange={e => set('role', e.target.value)} disabled={isBusy}>{roleOptions.map(option => <option key={option}>{option}</option>)}</select></div>
              <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-28">Status</span><select className="flex-1 text-xs" value={form.status} onChange={e => set('status', e.target.value)} disabled={isBusy}><option>Active</option><option>Inactive</option></select></div>
            </div>
          </div>
          <div className="bg-bg-secondary border border-border-custom p-3">
            <div className="text-accent-teal font-bold text-sm mb-3">User Rights (Quick View)</div>
            <div className="space-y-3 text-xs text-text-secondary">
              <p>Module access is managed by admin from Management &gt; User Rights.</p>
              <p>The selected role gives the starting view access, and User Rights is where admin overrides individual modules, reports, and H.R.M. screens for each user.</p>
              <div className="border border-border-custom/40 bg-bg-primary p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span>Selected Role</span>
                  <span className="text-accent-cyan">{form.role || 'Operator'}</span>
                </div>
                {isCloudModeEnabled ? <div className="flex items-center justify-between"><span>Business</span><span className="text-accent-cyan">{form.organizationName || 'Assigned automatically'}</span></div> : null}
                <div className="flex items-center justify-between">
                  <span>Selected Status</span>
                  <span className="text-accent-cyan">{form.status || 'Active'}</span>
                </div>
              </div>
              {isCloudModeEnabled ? (
                isPlatformOwner
                  ? <p>Create the client admin, then hand over only the User ID and Password. If they forget the password later, select that user, enter a new password, and click Reset Password.</p>
                  : <p>Use this screen to add, update, disable, or reset passwords for users in your own business.</p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="bg-bg-secondary border border-border-custom p-3">
          <div className="text-accent-teal font-bold text-sm mb-3">User List</div>
          <div className="border border-border-custom">
            <table className="w-full">
              <thead><tr className="bg-bg-tertiary">
                <th className="text-xs py-1 px-2 border border-border-custom text-white">#</th>
                <th className="text-xs py-1 px-2 border border-border-custom text-white">Username</th>
                <th className="text-xs py-1 px-2 border border-border-custom text-white">Full Name</th>
                {isCloudModeEnabled ? <th className="text-xs py-1 px-2 border border-border-custom text-white">Business</th> : null}
                <th className="text-xs py-1 px-2 border border-border-custom text-white">Role</th>
                {isCloudModeEnabled ? null : <th className="text-xs py-1 px-2 border border-border-custom text-white">Email</th>}
                <th className="text-xs py-1 px-2 border border-border-custom text-white">Status</th>
              </tr></thead>
              <tbody>
                {visibleUsers.map((u, i) => (
                  <tr key={u.id as string} onClick={() => selectRow(u)} className={`cursor-pointer hover:bg-accent-orange/20 ${selId === u.id ? 'bg-accent-orange/40' : i % 2 === 0 ? 'bg-bg-primary' : 'bg-bg-secondary'}`}>
                    <td className="text-xs py-1 px-2 border border-border-custom">{i + 1}</td>
                    <td className="text-xs py-1 px-2 border border-border-custom text-accent-cyan">{u.username as string}</td>
                    <td className="text-xs py-1 px-2 border border-border-custom">{u.fullName as string}</td>
                    {isCloudModeEnabled ? <td className="text-xs py-1 px-2 border border-border-custom">{(u.organizationName as string) || '-'}</td> : null}
                    <td className="text-xs py-1 px-2 border border-border-custom">{u.role as string}</td>
                    {isCloudModeEnabled ? null : <td className="text-xs py-1 px-2 border border-border-custom">{u.email as string}</td>}
                    <td className={`text-xs py-1 px-2 border border-border-custom font-semibold ${u.status === 'Active' ? 'text-success' : 'text-danger'}`}>{u.status as string}</td>
                  </tr>
                ))}
                {visibleUsers.length === 0 ? (
                  <tr>
                    <td colSpan={isCloudModeEnabled ? 6 : 6} className="text-xs py-3 px-2 border border-border-custom text-text-secondary text-center">
                      {isCloudModeEnabled && isPlatformOwner ? 'No client admin accounts found yet.' : 'No user accounts found yet.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

const UserRightsModule = () => {
  const store = useData();
  const { toast } = useToast();
  const users = useCollection('user-logins');
  const rights = useCollection('user-rights') as UserRightsRecord[];
  const { currentUser } = useSession();
  const sessionUser = currentUser || readSessionUser();
  const normalizedSessionRole = String(sessionUser?.role || '').trim().toLowerCase();
  const isPlatformOwner = normalizedSessionRole === 'platform owner';
  const [selUser, setSelUser] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [isLoadingCloudRights, setIsLoadingCloudRights] = React.useState(false);

  const areRightsEqual = React.useCallback((left: Record<string, boolean>, right: Record<string, boolean>) => {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every(key => left[key] === right[key]);
  }, []);

  React.useEffect(() => {
    if (!users.length) {
      if (selUser !== 'admin') {
        setSelUser('admin');
      }
      return;
    }

    const hasSelectedUser = users.some(user => String(user.username || '').trim().toLowerCase() === selUser.trim().toLowerCase());
    if (!hasSelectedUser) {
      setSelUser(String(users[0]?.username || 'admin'));
    }
  }, [selUser, users]);

  const normalizedSelUser = React.useMemo(() => String(selUser || '').trim().toLowerCase(), [selUser]);

  // Build rights map for selected user
  const userRightsFromStore = React.useMemo(() => {
    const rec = rights.find(r => String(r.username || '').trim().toLowerCase() === normalizedSelUser);
    return (rec?.data as Record<string, boolean>) || {};
  }, [normalizedSelUser, rights]);

  const [draftRights, setDraftRights] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    setDraftRights(userRightsFromStore);
  }, [normalizedSelUser, userRightsFromStore]);

  React.useEffect(() => {
    if (!isCloudModeEnabled || !isPlatformOwner || !normalizedSelUser) {
      return;
    }

    let active = true;
    setIsLoadingCloudRights(true);

    void fetchCloudUserRights(normalizedSelUser)
      .then((record) => {
        if (!active || !record) {
          return;
        }

        const existing = rights.find(item => String(item.username || '').trim().toLowerCase() === normalizedSelUser);
        if (existing?.id) {
          runWithoutCloudSync(() => {
            store.update('user-rights', String(existing.id), { username: record.username, data: record.data });
          });
          return;
        }

        runWithoutCloudSync(() => {
          store.add('user-rights', { username: record.username, data: record.data });
        });
      })
      .catch((error) => {
        if (active) {
          console.error('Failed to load cloud user rights', error);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingCloudRights(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isPlatformOwner, normalizedSelUser, rights, store]);

  const hasUnsavedChanges = React.useMemo(() => !areRightsEqual(draftRights, userRightsFromStore), [areRightsEqual, draftRights, userRightsFromStore]);

  const selectedUser = React.useMemo(() => {
    return (users.find(u => String(u.username || '').trim().toLowerCase() === normalizedSelUser) || null) as Record<string, any> | null;
  }, [normalizedSelUser, users]);
  const isSelectedClientAdmin = String(selectedUser?.role || '').trim().toLowerCase() === 'client admin';
  const isLockedClientAdminPreferencesView = (moduleId: string, action: string) => (
    isSelectedClientAdmin
    && moduleId === 'management-software-preferences'
    && action === 'View'
  );

  const rKey = (moduleId: string, c: string) => `${moduleId}::${c}`;
  const enforceMandatoryRights = React.useCallback((input: Record<string, boolean>) => {
    if (!isSelectedClientAdmin) {
      return input;
    }

    const normalized = { ...input };
    normalized[rKey('management-software-preferences', 'View')] = true;
    return normalized;
  }, [isSelectedClientAdmin]);

  const applyDraftChange = React.useCallback((updater: (current: Record<string, boolean>) => Record<string, boolean>) => {
    setDraftRights(current => enforceMandatoryRights(updater(current)));
  }, [enforceMandatoryRights]);

  const withViewDependency = React.useCallback((next: Record<string, boolean>, moduleId: string, action: string) => {
    if (action !== 'View' && next[rKey(moduleId, action)] === true) {
      next[rKey(moduleId, 'View')] = true;
    }

    if (action === 'View' && next[rKey(moduleId, 'View')] === false) {
      RIGHTS_ACTIONS.filter(rightAction => rightAction !== 'View').forEach(rightAction => {
        next[rKey(moduleId, rightAction)] = false;
      });
    }

    return next;
  }, []);

  const isChecked = (moduleId: string, c: string, legacySubject?: string) => {
    if (isLockedClientAdminPreferencesView(moduleId, c)) {
      return true;
    }

    const key = rKey(moduleId, c);
    if (key in draftRights) {
      return draftRights[key] !== false;
    }

    if (c !== 'View') {
      return false;
    }

    return getEffectiveRight(selectedUser as any, moduleId, c, rights, legacySubject);
  };

  const saveRights = async () => {
    if (!selUser.trim()) {
      toast('Select a user first', 'error');
      return;
    }

    const updated = enforceMandatoryRights({ ...draftRights });
    const rec = rights.find(r => String(r.username || '').trim().toLowerCase() === normalizedSelUser);

    setIsSaving(true);
    try {
      let syncedRights: UserRightsRecord[];
      if (rec) {
        runWithoutCloudSync(() => {
          store.update('user-rights', rec.id as string, { username: selUser.trim(), data: updated });
        });
        syncedRights = rights.map(item => (
          item.id === rec.id
            ? { ...item, username: selUser.trim(), data: updated }
            : item
        ));
      } else {
        const newRecord = runWithoutCloudSync(() => (
          store.add('user-rights', { username: selUser.trim(), data: updated }) as UserRightsRecord
        ));
        syncedRights = [...rights, newRecord];
      }

      if (isCloudModeEnabled) {
        if (isPlatformOwner) {
          const savedRecord = await saveCloudUserRights(selUser.trim(), updated);
          if (rec) {
            runWithoutCloudSync(() => {
              store.update('user-rights', rec.id as string, { username: savedRecord.username, data: savedRecord.data });
            });
          } else {
            runWithoutCloudSync(() => {
              store.add('user-rights', { username: savedRecord.username, data: savedRecord.data });
            });
          }
          toast('User rights saved');
          return;
        }

        await replaceCloudCollection('user-rights', syncedRights.map(item => ({ ...item, id: String(item.id || '') })));
      }

      toast('User rights saved');
    } catch (error) {
      console.error('Failed to save user rights', error);
      const message = error instanceof Error && String(error.message || '').trim()
        ? error.message
        : 'User rights were saved locally but cloud sync failed. Please save again and wait for completion.';
      toast(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const toggle = (moduleId: string, c: string, legacySubject?: string) => {
    if (isLockedClientAdminPreferencesView(moduleId, c)) {
      toast('Client Admin must keep Software Preferences access enabled', 'info');
      return;
    }

    applyDraftChange(current => {
      const updated = { ...current, [rKey(moduleId, c)]: !isChecked(moduleId, c, legacySubject) };
      return withViewDependency(updated, moduleId, c);
    });
  };

  const selectAll = (col: string) => {
    applyDraftChange(current => {
      const updated = { ...current };
      USER_RIGHTS_SECTIONS.forEach(section => {
        section.items.forEach(item => {
          updated[rKey(item.moduleId, col)] = true;
          withViewDependency(updated, item.moduleId, col);
        });
      });
      return updated;
    });
    toast(`${col} rights staged for save`);
  };
  const clearAll = (col: string) => {
    applyDraftChange(current => {
      const updated = { ...current };
      USER_RIGHTS_SECTIONS.forEach(section => {
        section.items.forEach(item => {
          updated[rKey(item.moduleId, col)] = false;
          withViewDependency(updated, item.moduleId, col);
        });
      });
      return updated;
    });
    toast(`${col} rights staged for save`);
  };

  const handleUserChange = (username: string) => {
    if (hasUnsavedChanges) {
      toast('Click the tick button to save rights before switching users', 'error');
      return;
    }
    setSelUser(username);
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-4 space-y-4">
        <h2 className="text-accent-cyan font-bold text-xl">USER RIGHTS</h2>
        <div className="flex items-center gap-4">
          <select className="w-48 text-xs" value={selUser} onChange={e => handleUserChange(e.target.value)}>
            {users.map(u => <option key={u.id as string} value={u.username as string}>{u.username as string}</option>)}
            {users.length === 0 && <option>admin</option>}
          </select>
          <button
            type="button"
            onClick={() => { void saveRights(); }}
            disabled={isSaving || isLoadingCloudRights || !hasUnsavedChanges || !selUser.trim()}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold border ${!isSaving && !isLoadingCloudRights && hasUnsavedChanges && selUser.trim() ? 'bg-success text-white border-success hover:brightness-110' : 'bg-bg-tertiary text-text-secondary border-border-custom cursor-not-allowed opacity-60'}`}
            title="Save rights"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
            {isSaving ? 'Saving...' : isLoadingCloudRights ? 'Loading...' : 'Save Rights'}
          </button>
        </div>
        <p className="text-xs text-text-secondary">Admin controls what each user can open from here. View follows the user's role until you override it with a checkbox. Edit, Add, Delete, Post, Scan, and Print now automatically require View for that same module. Tick Save Rights to preserve your changes.</p>
        <div className="border border-border-custom">
          <table className="w-full">
            <thead className="sticky top-0">
              <tr className="bg-bg-tertiary">
                <th className="text-xs py-2 px-2 border border-border-custom text-white text-left">Particulars</th>
                {RIGHTS_ACTIONS.map(h => (
                  <th key={h} className="text-xs py-2 px-1 border border-border-custom text-white text-center w-16">{h}</th>
                ))}
              </tr>
              <tr className="bg-bg-secondary">
                <th className="text-xs py-1 px-2 border border-border-custom text-accent-teal text-left">Modules</th>
                {RIGHTS_ACTIONS.map(h => (
                  <th key={h} className="text-xs py-1 px-1 border border-border-custom">
                    <div className="flex flex-col gap-1">
                      <button onClick={() => selectAll(h)} className="px-1 py-0.5 bg-bg-tertiary text-[10px] hover:bg-bg-primary">Select All</button>
                      <button onClick={() => clearAll(h)} className="px-1 py-0.5 bg-bg-tertiary text-[10px] hover:bg-bg-primary">Clear All</button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {USER_RIGHTS_SECTIONS.map((section) => (
                <React.Fragment key={section.title}>
                  <tr className="bg-bg-tertiary">
                    <td className="text-xs py-1.5 px-2 border border-border-custom text-accent-teal font-bold" colSpan={RIGHTS_ACTIONS.length + 1}>{section.title}</td>
                  </tr>
                  {section.items.map((item, index) => (
                    <tr key={item.moduleId} className={index % 2 === 0 ? 'bg-bg-primary' : 'bg-bg-secondary'}>
                      <td className="text-xs py-1 px-2 border border-border-custom">{item.label}</td>
                      {RIGHTS_ACTIONS.map(action => (
                        <td key={action} className="text-xs py-1 px-1 border border-border-custom text-center">
                          <input
                            type="checkbox"
                            className="w-3 h-3"
                            checked={isChecked(item.moduleId, action, item.legacySubject)}
                            onChange={() => toggle(item.moduleId, action, item.legacySubject)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const ChangePasswordModule = () => {
  const store = useData();
  const { toast } = useToast();
  const users = useCollection('user-logins');
  const [current, setCurrent] = React.useState('');
  const [newPw, setNewPw] = React.useState('');
  const [confirm, setConfirm] = React.useState('');

  const handleChange = () => {
    if (!current) { toast('Enter current password', 'error'); return; }
    if (newPw.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    if (newPw !== confirm) { toast('Passwords do not match', 'error'); return; }
    if (isCloudModeEnabled) {
      void changeCloudPassword(current, newPw)
        .then(() => {
          toast('Password changed successfully');
          setCurrent(''); setNewPw(''); setConfirm('');
        })
        .catch((error) => {
          toast(error instanceof Error ? error.message : 'Unable to change password', 'error');
        });
      return;
    }
    const sessionUser = readSessionUser();
    if (!sessionUser) { toast('No active session found', 'error'); return; }
    const account = users.find(u => String(u.username || '').toLowerCase() === sessionUser.username.toLowerCase());
    if (!account) { toast('Your user account was not found', 'error'); return; }
    if (String(account.password || '') !== current) { toast('Current password is incorrect', 'error'); return; }
    store.update('user-logins', account.id as string, { ...account, password: newPw });
    toast('Password changed successfully');
    setCurrent(''); setNewPw(''); setConfirm('');
  };
  const handleClear = () => { setCurrent(''); setNewPw(''); setConfirm(''); };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-3">
        <div className="bg-bg-tertiary border border-border-custom p-2">
          <h1 className="text-accent-orange font-bold text-xl">CHANGE PASSWORD</h1>
        </div>
        <div className="flex justify-center">
          <div className="bg-bg-secondary border border-border-custom w-full max-w-md p-6">
            <div className="p-3">
              <div className="text-accent-teal font-bold text-lg mb-6 text-center">Change Your Password</div>
              <div className="text-xs text-text-secondary mb-4 text-center">This changes only the password of the currently signed-in user.</div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-text-secondary block mb-1">Current Password</label>
                  <div className="flex items-center bg-white border border-border-custom">
                    <svg className="w-4 h-4 text-text-secondary ml-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                    <input className="flex-1 text-xs py-2 px-2 border-0" type="password" value={current} onChange={e => setCurrent(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-secondary block mb-1">New Password</label>
                  <div className="flex items-center bg-white border border-border-custom">
                    <svg className="w-4 h-4 text-text-secondary ml-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                    <input className="flex-1 text-xs py-2 px-2 border-0" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-secondary block mb-1">Confirm New Password</label>
                  <div className="flex items-center bg-white border border-border-custom">
                    <svg className="w-4 h-4 text-text-secondary ml-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                    <input className="flex-1 text-xs py-2 px-2 border-0" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
                  </div>
                </div>
                <div className="pt-4 flex gap-2">
                  <button type="button" onClick={handleChange} className="flex-1 bg-accent-orange text-white py-2 px-4 text-sm font-semibold hover:brightness-110 transition-all flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>Change Password
                  </button>
                  <button type="button" onClick={handleClear} className="px-4 py-2 bg-bg-tertiary border border-border-custom text-sm hover:bg-bg-secondary flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>Clear
                  </button>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-border-custom">
                <p className="text-xs text-text-secondary text-center">Password must be at least 6 characters long</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const FinancialYearsModule = () => {
  const store = useData();
  const { toast } = useToast();
  const years = useCollection('financial-years');
  const [form, setForm] = React.useState({ startDate: '', endDate: '' });
  const [selId, setSelId] = React.useState<string | null>(null);

  const handleAdd = () => { setSelId(null); setForm({ startDate: '', endDate: '' }); };
  const handleSave = () => {
    if (!form.startDate || !form.endDate) { toast('Start & End dates required', 'error'); return; }
    const nextStatus = getFinancialYearStatus(form as Record<string, unknown>);
    const payload = { ...form, status: `${nextStatus.charAt(0).toUpperCase()}${nextStatus.slice(1)}` };
    if (selId) { store.update('financial-years', selId, payload); toast('Financial year updated'); } else { store.add('financial-years', payload); toast('Financial year added'); }
    setSelId(null); setForm({ startDate: '', endDate: '' });
  };
  const handleDelete = () => {
    if (!selId) { toast('Select a year first', 'error'); return; }
    store.remove('financial-years', selId); setSelId(null); setForm({ startDate: '', endDate: '' }); toast('Financial year deleted');
  };
  const selectRow = (y: Record<string, unknown>) => { setSelId(y.id as string); setForm({ startDate: (y.startDate as string) || '', endDate: (y.endDate as string) || '' }); };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-4">
        <div className="bg-bg-tertiary border border-border-custom p-2 flex justify-between items-center">
          <h1 className="text-accent-orange font-bold text-xl">FINANCIAL YEARS</h1>
          <div className="flex gap-1">
            <button onClick={handleAdd} className="p-2 bg-bg-secondary border border-border-custom hover:bg-bg-tertiary" title="New"><svg className="w-5 h-5 text-[#2196f3]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5v14" /></svg></button>
            <button onClick={handleSave} className="p-2 bg-bg-secondary border border-border-custom hover:bg-bg-tertiary" title="Save"><svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg></button>
            <button onClick={handleDelete} className="p-2 bg-bg-secondary border border-border-custom hover:bg-bg-tertiary" title="Delete"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10 11v6M14 11v6M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg></button>
          </div>
        </div>
        <div className="bg-bg-secondary border border-border-custom p-3 space-y-3">
          <div className="text-accent-teal font-bold text-sm">Financial Year Details</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-text-secondary block mb-1">Start Date</label>
              <input className="w-full text-xs" type="text" placeholder="DD/MM/YYYY" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-text-secondary block mb-1">End Date</label>
              <input className="w-full text-xs" type="text" placeholder="DD/MM/YYYY" value={form.endDate} onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-text-secondary block mb-1">Status</label>
              <div className="text-xs text-text-secondary py-2">Automatic from date range</div>
            </div>
          </div>
        </div>
        <div className="bg-bg-secondary border border-border-custom p-3">
          <div className="text-accent-teal font-bold text-sm mb-2">Financial Years List</div>
          <table className="w-full">
            <thead><tr className="bg-bg-tertiary"><th className="text-xs py-1 px-2 border border-border-custom text-white">#</th><th className="text-xs py-1 px-2 border border-border-custom text-white">Start Date</th><th className="text-xs py-1 px-2 border border-border-custom text-white">End Date</th><th className="text-xs py-1 px-2 border border-border-custom text-white">Status</th></tr></thead>
            <tbody>
              {years.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-xs py-3 px-2 border border-border-custom text-text-secondary text-center">No financial years configured yet.</td>
                </tr>
              ) : years.map((y,idx) => (
                <tr key={y.id} className={`cursor-pointer ${selId===y.id?'bg-accent-orange':'hover:bg-bg-tertiary'} ${idx%2===0?'bg-bg-secondary':'bg-bg-primary'}`} onClick={() => selectRow(y)}>
                  <td className="text-xs py-1 px-2 border border-border-custom">{idx+1}</td>
                  <td className="text-xs py-1 px-2 border border-border-custom">{y.startDate}</td>
                  <td className="text-xs py-1 px-2 border border-border-custom">{y.endDate}</td>
                  <td className="text-xs py-1 px-2 border border-border-custom">{y.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const SoftwarePreferencesModule = () => {
  const store = useData();
  const { toast } = useToast();
  const prefs = useCollection('preferences');
  const userLogins = useCollection('user-logins');
  const userRights = useCollection('user-rights') as UserRightsRecord[];
  const defaults = DEFAULT_PREFERENCES;
  const saved = prefs[0] || {};
  const [form, setForm] = React.useState<Record<string, string | number | boolean>>(() => ({ ...defaults, ...saved }));
  const f = (key: string) => form[key] ?? defaults[key] ?? '';
  const set = (key: string, val: string | number | boolean) => setForm(p => ({ ...p, [key]: val }));
  const handleSave = () => {
    if (saved.id) { store.update('preferences', saved.id as string, form); } else { store.add('preferences', form); }
    toast('Preferences saved');
  };
  const colVisItems: [string, string, boolean][] = [['colHSCode','H.S. Code',false],['colModel','Model No.',false],['colSize','Size',false],['colColour','Colour',false],['colBatch','Batch No. & Expiry Date',true],['colMfgDate','Manufacturing Date',false],['colAddQty','Additional Quantity Column',false],['colDefQty','Default Quantity Column',true],['colFocPacks','FOC / Bonus (Packs)',false],['colFocPcs','FOC / Bonus (Pcs)',false],['colUnit','Measurement Unit',true],['colPacking','Packing',false],['colMRP','MRP',false],['colSalesTax','Sales Tax',true],['colFED','F.E.D.',false],['colExtraTax','Extra Tax',true],['colFurtherTax','Further Tax',true],['colDiscount','Discount',true]];

  const handleExportBackup = () => {
    const backup: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('afroz-')) {
        backup[key] = localStorage.getItem(key) || '';
      }
    }
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `afroz-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup exported successfully');
  };

  const handleImportBackup = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (typeof data !== 'object' || data === null) throw new Error('Invalid format');
          let count = 0;
          for (const [key, value] of Object.entries(data)) {
            if (typeof key === 'string' && key.startsWith('afroz-')) {
              localStorage.setItem(key, value as string);
              count++;
            }
          }
          toast(`Restored ${count} collections. Refresh to see changes.`);
          setTimeout(() => window.location.reload(), 1500);
        } catch {
          toast('Invalid backup file', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleClearAllData = async () => {
    if (!window.confirm('Are you sure you want to delete ALL data? This cannot be undone.')) return;
    const currentSessionUser = readSessionUser();
    const currentUsername = String(currentSessionUser?.username || '').trim().toLowerCase();
    const currentUserId = String(currentSessionUser?.id || '').trim();

    const localKeys: string[] = [];
    const localCollections = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DATA_STORAGE_PREFIX)) {
        continue;
      }

      localKeys.push(key);

      if (key.startsWith(SERIAL_STORAGE_PREFIX)) {
        localCollections.add(key.slice(SERIAL_STORAGE_PREFIX.length));
        continue;
      }

      if (key === CLOUD_COLLECTION_META_STORAGE_KEY || key === `${DATA_STORAGE_PREFIX}__seeded__`) {
        continue;
      }

      localCollections.add(key.slice(DATA_STORAGE_PREFIX.length));
    }

    let cloudCollections: string[] = [];
    try {
      const rawCloudCollections = localStorage.getItem(CLOUD_COLLECTION_META_STORAGE_KEY);
      const parsedCloudCollections = rawCloudCollections ? JSON.parse(rawCloudCollections) : [];
      cloudCollections = Array.isArray(parsedCloudCollections) ? parsedCloudCollections.map(item => String(item)) : [];
    } catch {
      cloudCollections = [];
    }

    const collectionsToClear = Array.from(new Set([...localCollections, ...cloudCollections]))
      .filter(collection => collection && !PRESERVED_CLEAR_DATA_COLLECTIONS.has(collection));

    if (isCloudModeEnabled) {
      const failedCollections: string[] = [];
      const removableUsers = userLogins.filter(record => String(record.id || '') !== currentUserId);

      for (const account of removableUsers) {
        try {
          await deleteCloudUser(String(account.id || ''));
        } catch {
          failedCollections.push(`user:${String(account.username || account.id || '')}`);
        }
      }

      await Promise.all(collectionsToClear.map(async collection => {
        try {
          await replaceCloudCollection(collection, []);
        } catch {
          failedCollections.push(collection);
        }
      }));

      if (failedCollections.length > 0) {
        toast(`Cloud cleanup failed for: ${failedCollections.join(', ')}`, 'error');
        return;
      }
    }

    const preservedUserLogins = currentUserId
      ? userLogins.filter(record => String(record.id || '') === currentUserId)
      : userLogins;
    const preservedUserRights = currentUsername
      ? userRights.filter(record => String(record.username || '').trim().toLowerCase() === currentUsername)
      : userRights;

    let removedKeys = 0;
    localKeys.forEach(key => {
      const shouldPreserveCollection = key === `${DATA_STORAGE_PREFIX}user-logins`
        || key === `${DATA_STORAGE_PREFIX}user-rights`
        || key === `${DATA_STORAGE_PREFIX}preferences`
        || key === `${SERIAL_STORAGE_PREFIX}user-logins`
        || key === `${SERIAL_STORAGE_PREFIX}user-rights`
        || key === `${SERIAL_STORAGE_PREFIX}preferences`;

      if (shouldPreserveCollection) {
        return;
      }

      localStorage.removeItem(key);
      removedKeys += 1;
    });

    localStorage.setItem(`${DATA_STORAGE_PREFIX}user-logins`, JSON.stringify(preservedUserLogins));
    localStorage.setItem(`${DATA_STORAGE_PREFIX}user-rights`, JSON.stringify(preservedUserRights));
    localStorage.setItem(CLOUD_COLLECTION_META_STORAGE_KEY, JSON.stringify([]));
    toast(`Cleared ${collectionsToClear.length} data collections and removed ${removedKeys} local keys. Refreshing...`);
    setTimeout(() => window.location.reload(), 1500);
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-accent-cyan font-bold text-xl">PREFERENCES</h2>
          <button onClick={handleSave} className="px-4 py-1.5 bg-accent-teal text-white text-xs font-bold hover:brightness-110">Save Preferences</button>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <div className="text-accent-teal font-bold text-sm mb-3">Currency</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Big Currency Name</span><input className="flex-1 text-xs" type="text" value={f('bigCurrency') as string} onChange={e => set('bigCurrency', e.target.value)} /></div>
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Small Currency Name</span><input className="flex-1 text-xs" type="text" value={f('smallCurrency') as string} onChange={e => set('smallCurrency', e.target.value)} /></div>
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Currency Symbol</span><input className="flex-1 text-xs" type="text" value={f('symbol') as string} onChange={e => set('symbol', e.target.value)} /></div>
              </div>
            </div>
            <div>
              <div className="text-accent-teal font-bold text-sm mb-3">General</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Date Format</span><select className="flex-1 text-xs" value={f('dateFormat') as string} onChange={e => set('dateFormat', e.target.value)}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></select></div>
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Default Tax Rate</span><input className="w-20 text-xs text-center" type="number" value={f('defaultTax') as number} onChange={e => set('defaultTax', Number(e.target.value))} /></div>
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Default Warehouse</span><input className="flex-1 text-xs" type="text" value={f('defaultWarehouse') as string} onChange={e => set('defaultWarehouse', e.target.value)} /></div>
              </div>
            </div>
            <div>
              <div className="text-accent-teal font-bold text-sm mb-3">Description of Taxes</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Federal Excise Duty</span><input className="flex-1 text-xs" type="text" value={f('fedDesc') as string} onChange={e => set('fedDesc', e.target.value)} /></div>
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Federal Sales Tax</span><input className="flex-1 text-xs" type="text" value={f('fedSalesTax') as string} onChange={e => set('fedSalesTax', e.target.value)} /></div>
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">State / Prov Sales Tax</span><input className="flex-1 text-xs" type="text" value={f('stateSalesTax') as string} onChange={e => set('stateSalesTax', e.target.value)} /></div>
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Extra Tax</span><input className="flex-1 text-xs" type="text" value={f('extraTax') as string} onChange={e => set('extraTax', e.target.value)} /></div>
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Tax on Un-Registered</span><input className="flex-1 text-xs" type="text" value={f('furtherTax') as string} onChange={e => set('furtherTax', e.target.value)} /></div>
              </div>
            </div>
            <div>
              <div className="text-accent-teal font-bold text-sm mb-3">Decimal Places</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Quantity (General)</span><input className="w-16 text-xs text-center" type="number" value={f('qtyDec') as number} onChange={e => set('qtyDec', Number(e.target.value))} /><span className="text-xs text-text-secondary">(0 - 4)</span></div>
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Rate (General)</span><input className="w-16 text-xs text-center" type="number" value={f('rateDec') as number} onChange={e => set('rateDec', Number(e.target.value))} /><span className="text-xs text-text-secondary">(0 - 4)</span></div>
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Quantity (Production)</span><input className="w-16 text-xs text-center" type="number" value={f('qtyProd') as number} onChange={e => set('qtyProd', Number(e.target.value))} /><span className="text-xs text-text-secondary">(0 - 6)</span></div>
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary w-32">Rate (Production)</span><input className="w-16 text-xs text-center" type="number" value={f('rateProd') as number} onChange={e => set('rateProd', Number(e.target.value))} /><span className="text-xs text-text-secondary">(0 - 6)</span></div>
              </div>
            </div>
            <div>
              <div className="text-accent-teal font-bold text-sm mb-3">Display Options</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2"><input className="w-4 h-4" type="checkbox" checked={!!f('gridLines')} onChange={e => set('gridLines', e.target.checked)} /><span className="text-xs text-text-secondary">Show Grid Lines in Invoice Tables</span></div>
                <div className="flex items-center gap-2"><input className="w-4 h-4" type="checkbox" checked={!!f('printLogo')} onChange={e => set('printLogo', e.target.checked)} /><span className="text-xs text-text-secondary">Print Company Logo on Documents</span></div>
                <div className="flex items-center gap-2"><input className="w-4 h-4" type="checkbox" checked={!!f('autoBackup')} onChange={e => set('autoBackup', e.target.checked)} /><span className="text-xs text-text-secondary">Auto Backup Data</span></div>
              </div>
            </div>
            <div>
              <div className="text-accent-teal font-bold text-sm mb-3">Inventory Movement Linked Documents</div>
              <select className="w-full text-xs" value={f('invMovement') as string} onChange={e => set('invMovement', e.target.value)}>
                {INVENTORY_MOVEMENT_LINK_OPTIONS.map(option => <option key={option}>{option}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div className="text-accent-teal font-bold text-sm mb-3">Columns Visible</div>
            <div className="space-y-2">
              {colVisItems.map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <input className="w-4 h-4" type="checkbox" checked={!!f(key)} onChange={e => set(key, e.target.checked)} />
                  <span className="text-xs text-text-secondary">{label}</span>
                  {key === 'colDefQty' && <div className="flex items-center gap-2 ml-auto"><span className="text-xs text-text-secondary">Column Name</span><input className="w-20 text-xs" type="text" value={f('colDefQtyName') as string} onChange={e => set('colDefQtyName', e.target.value)} /></div>}
                </div>
              ))}
            </div>

            {/* Data Backup & Restore */}
            <div className="mt-6 pt-4 border-t border-border-custom">
              <div className="text-accent-teal font-bold text-sm mb-3">Data Backup &amp; Restore</div>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <button onClick={handleExportBackup} className="flex items-center gap-2 px-4 py-2 bg-accent-teal text-white text-xs font-bold hover:brightness-110">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Export Backup (JSON)
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleImportBackup} className="flex items-center gap-2 px-4 py-2 bg-accent-orange text-white text-xs font-bold hover:brightness-110">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    Import Backup (JSON)
                  </button>
                </div>
                <p className="text-xs text-text-secondary italic">Export saves all application data as a JSON file. Import restores from a previously exported backup.</p>
                <div className="pt-2 border-t border-border-custom/50">
                  <button onClick={handleClearAllData} className="flex items-center gap-2 px-4 py-2 bg-danger text-white text-xs font-bold hover:brightness-110">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10 11v6M14 11v6M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                    Clear All Data
                  </button>
                  <p className="text-xs text-danger mt-1">Warning: This will permanently delete all saved data and cannot be undone.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Module registry mapping module IDs to their React components
export const moduleRegistry: Record<string, React.FC> = {
  // Management
  'management-dashboard': () => null,
  'management-company-setup': CompanySetupModule,
  'management-financial-years': FinancialYearsModule,
  'management-user-logins': UserLoginsModule,
  'management-user-rights': UserRightsModule,
  'management-change-password': ChangePasswordModule,
  'management-software-preferences': SoftwarePreferencesModule,

  // H.R.M.
  'h-r-m-workers': () => <LazyModuleBoundary><WorkersModule /></LazyModuleBoundary>,
  'h-r-m-attendance-register': () => <LazyModuleBoundary><WorkerAttendanceModule /></LazyModuleBoundary>,
  'h-r-m-worker-advances': () => <LazyModuleBoundary><WorkerAdvancesModule /></LazyModuleBoundary>,
  'h-r-m-monthly-payroll': () => <LazyModuleBoundary><WorkerPayrollModule /></LazyModuleBoundary>,

  // Lists
  'lists-chart-of-accounts': () => <LazyModuleBoundary><ChartOfAccountsModule moduleId="lists-chart-of-accounts" /></LazyModuleBoundary>,
  'lists-vendors': () => <LazyModuleBoundary><VendorsModule /></LazyModuleBoundary>,
  'lists-vendor-types': () => <LazyModuleBoundary><SimpleListTemplate title="Vendor Types" storageKey="vendor-types" moduleId="lists-vendor-types" items={['Local Vendors', 'Import Vendors', 'Service Vendors']} /></LazyModuleBoundary>,
  'lists-customers': () => <LazyModuleBoundary><CustomersModule /></LazyModuleBoundary>,
  'lists-customer-types': () => <LazyModuleBoundary><SimpleListTemplate title="Customer Types" storageKey="customer-types" moduleId="lists-customer-types" items={['Wholesale', 'Retail', 'Institutional', 'Government']} /></LazyModuleBoundary>,
  'lists-customer-regions': () => <LazyModuleBoundary><SimpleListTemplate title="Customer Regions" storageKey="customer-regions" moduleId="lists-customer-regions" items={['Lahore', 'Karachi', 'Islamabad', 'Faisalabad', 'Multan', 'Peshawar', 'Gujranwala']} /></LazyModuleBoundary>,
  'lists-customer-groups-1': () => <LazyModuleBoundary><SimpleListTemplate title="Customer Groups 1" storageKey="customer-groups-1" moduleId="lists-customer-groups-1" items={['Group A', 'Group B', 'Group C']} /></LazyModuleBoundary>,
  'lists-customer-groups-2': () => <LazyModuleBoundary><SimpleListTemplate title="Customer Groups 2" storageKey="customer-groups-2" moduleId="lists-customer-groups-2" items={['Sub Group 1', 'Sub Group 2']} /></LazyModuleBoundary>,
  'lists-products': () => <LazyModuleBoundary><ProductsModule moduleId="lists-products" /></LazyModuleBoundary>,
  'lists-warehouses': () => <LazyModuleBoundary><SimpleListTemplate title="Warehouses" storageKey="warehouses" moduleId="lists-warehouses" inputLabel="Warehouse name" items={['Main Store', 'Godown 2', 'Godown 3']} /></LazyModuleBoundary>,
  'lists-services': () => <LazyModuleBoundary><SimpleListTemplate title="Services" storageKey="services" moduleId="lists-services" inputLabel="Service name" items={['Delivery Service', 'Installation', 'Consulting']} /></LazyModuleBoundary>,
  'lists-service-categories': () => <LazyModuleBoundary><SimpleListTemplate title="Service Categories" storageKey="service-categories" moduleId="lists-service-categories" items={['Transport', 'Consulting', 'Maintenance']} /></LazyModuleBoundary>,
  'lists-states-province-tax-rates': () => <LazyModuleBoundary><SimpleListTemplate title="States/Province Tax Rates" storageKey="tax-rates" moduleId="lists-states-province-tax-rates" items={['Punjab - 16%', 'Sindh - 13%', 'KPK - 15%', 'Baluchistan - 15%', 'Islamabad - 17%']} /></LazyModuleBoundary>,
  'lists-cost-centres': () => <LazyModuleBoundary><SimpleListTemplate title="Cost Centres" storageKey="cost-centres" moduleId="lists-cost-centres" items={['Head Office', 'Branch Lahore', 'Branch Karachi']} /></LazyModuleBoundary>,

  // Opening Balances (reuse ChartOfAccounts / Products pattern)
  'opening-balances-accounts-opening-balances-tax-': () => <LazyModuleBoundary><ChartOfAccountsModule moduleId="opening-balances-accounts-opening-balances-tax-" titleOverride="ACCOUNTS OPENING BALANCES (TAX)" mode="tax" collectionKey="accounts-opening-balances-tax" /></LazyModuleBoundary>,
  'opening-balances-products-opening-balances-tax-': () => <LazyModuleBoundary><ProductsModule moduleId="opening-balances-products-opening-balances-tax-" titleOverride="PRODUCTS OPENING BALANCES (TAX)" mode="tax" collectionKey="products-opening-balances-tax" /></LazyModuleBoundary>,
  'opening-balances-accounts-opening-balances-non-tax-': () => <LazyModuleBoundary><ChartOfAccountsModule moduleId="opening-balances-accounts-opening-balances-non-tax-" titleOverride="ACCOUNTS OPENING BALANCES (NON-TAX)" mode="nonTax" collectionKey="accounts-opening-balances-non-tax" /></LazyModuleBoundary>,
  'opening-balances-products-opening-balances-non-tax-': () => <LazyModuleBoundary><ProductsModule moduleId="opening-balances-products-opening-balances-non-tax-" titleOverride="PRODUCTS OPENING BALANCES (NON-TAX)" mode="nonTax" collectionKey="products-opening-balances-non-tax" /></LazyModuleBoundary>,

  // Purchases
  'purchases-purchase-orders': () => <DynPurchaseInvoice title="Purchase Orders" storageKey="purchase-orders" moduleId="purchases-purchase-orders" />,
  'purchases-inwards-gate-passes': () => <DynPurchaseInvoice title="Inwards Gate Passes" storageKey="inwards-gate-passes" moduleId="purchases-inwards-gate-passes" />,
  'purchases-goods-received-notes': () => <DynPurchaseInvoice title="Goods Received Notes" storageKey="goods-received-notes" moduleId="purchases-goods-received-notes" />,
  'purchases-purchase-invoices': () => <DynPurchaseInvoice title="Purchase Invoices (Federal Tax)" storageKey="purchase-invoices" moduleId="purchases-purchase-invoices" />,
  'purchases-purchase-returns': () => <DynPurchaseInvoice title="Purchase Returns" storageKey="purchase-returns" moduleId="purchases-purchase-returns" />,

  // Sales (Tax)
  'sales-tax-quotations': () => <DynSaleInvoice title="Quotations (Sales Tax)" storageKey="quotations" moduleId="sales-tax-quotations" statusText="SALES TAX INVOICE" taxMode="tax" requirePartyTaxIds serialPrefix="T-INV-" showTaxSummary />,
  'sales-tax-sale-orders': () => <DynSaleInvoice title="Sale Orders (Sales Tax)" storageKey="sale-orders-tax" moduleId="sales-tax-sale-orders" statusText="SALES TAX ORDER" taxMode="tax" requirePartyTaxIds serialPrefix="T-INV-" showTaxSummary />,
  'sales-tax-sales-tax-invoices': () => <DynSaleInvoice title="Sales Tax Invoices" storageKey="sales-tax-invoices" moduleId="sales-tax-sales-tax-invoices" statusText="SALES TAX INVOICE" taxMode="tax" requirePartyTaxIds serialPrefix="T-INV-" showTaxSummary />,
  'sales-tax-sale-returns': () => <DynSaleInvoice title="Sale Returns (Sales Tax)" storageKey="sale-returns-tax" moduleId="sales-tax-sale-returns" statusText="SALES TAX RETURN" taxMode="tax" requirePartyTaxIds serialPrefix="T-INV-" showTaxSummary />,
  'sales-tax-quotations-sales-service-': () => <DynSaleInvoice title="Quotations (Sales/Service)" storageKey="quotations-sales-service" moduleId="sales-tax-quotations-sales-service-" statusText="SALES/SERVICE QUOTATION" taxMode="tax" requirePartyTaxIds serialPrefix="T-INV-" showTaxSummary />,
  'sales-tax-sales-service-orders': () => <DynSaleInvoice title="Sales/Service Orders" storageKey="sales-service-orders" moduleId="sales-tax-sales-service-orders" statusText="SALES/SERVICE ORDER" taxMode="tax" requirePartyTaxIds serialPrefix="T-INV-" showTaxSummary />,
  'sales-tax-sales-services-rendered-tax-invoices': () => <DynSaleInvoice title="Sales/Services Rendered Tax Invoices" storageKey="sales-services-rendered-tax" moduleId="sales-tax-sales-services-rendered-tax-invoices" statusText="SALES/SERVICES TAX INVOICE" taxMode="tax" requirePartyTaxIds serialPrefix="T-INV-" showTaxSummary />,
  'sales-tax-sales-services-rendered-tax-returns': () => <DynSaleInvoice title="Sales/Services Rendered Tax Returns" storageKey="sales-services-rendered-tax-returns" moduleId="sales-tax-sales-services-rendered-tax-returns" statusText="SALES/SERVICES TAX RETURN" taxMode="tax" requirePartyTaxIds serialPrefix="T-INV-" showTaxSummary />,

  // Sales (Non-Tax)
  'sales-non-tax-quotations': () => <DynSaleInvoice title="Quotations (Non Tax)" storageKey="quotations-nontax" moduleId="sales-non-tax-quotations" statusText="NON-TAX QUOTATION" taxMode="nonTax" serialPrefix="NT-INV-" showTaxSummary={false} />,
  'sales-non-tax-sale-orders': () => <DynSaleInvoice title="Sale Orders (Non Tax)" storageKey="sale-orders-nontax" moduleId="sales-non-tax-sale-orders" statusText="NON-TAX SALE ORDER" taxMode="nonTax" serialPrefix="NT-INV-" showTaxSummary={false} />,
  'sales-non-tax-sale-invoices': () => <DynSaleInvoice title="Sale Invoices" storageKey="sale-invoices" moduleId="sales-non-tax-sale-invoices" taxMode="nonTax" serialPrefix="NT-INV-" showTaxSummary={false} />,
  'sales-non-tax-sale-returns': () => <DynSaleInvoice title="Sale Returns (Non Tax)" storageKey="sale-returns-nontax" moduleId="sales-non-tax-sale-returns" statusText="NON-TAX SALE RETURN" taxMode="nonTax" serialPrefix="NT-INV-" showTaxSummary={false} />,

  // Payments (Tax)
  'payments-tax-bank-payments-to-vendors': () => <DynVendorPayment title="Bank Payments to Vendors (Tax)" modeValue="Bank" storageKey="bank-payments-vendors-tax" moduleId="payments-tax-bank-payments-to-vendors" withTax statusText="TAX VENDOR PAYMENT" />,
  'payments-tax-bank-payments-to-other-accounts': () => <DynAccountPayment title="Bank Payments to Other Accounts (Tax)" modeValue="Bank" storageKey="bank-payments-other-tax" moduleId="payments-tax-bank-payments-to-other-accounts" withTax statusText="TAX PAYMENT VOUCHER" />,
  'payments-tax-cash-payments-to-vendors': () => <DynVendorPayment title="Cash Payments to Vendors (Tax)" modeValue="Cash" storageKey="cash-payments-vendors-tax" moduleId="payments-tax-cash-payments-to-vendors" withTax statusText="TAX VENDOR PAYMENT" />,
  'payments-tax-cash-payments-to-other-accounts': () => <DynAccountPayment title="Cash Payments to Other Accounts (Tax)" modeValue="Cash" storageKey="cash-payments-other-tax" moduleId="payments-tax-cash-payments-to-other-accounts" withTax statusText="TAX PAYMENT VOUCHER" />,

  // Payments (Non-Tax)
  'payments-non-tax-payments-to-vendors': () => <DynVendorPayment title="Payments to Vendors" modeValue="Bank" storageKey="payments-vendors-nontax" moduleId="payments-non-tax-payments-to-vendors" statusText="NON-TAX VENDOR PAYMENT" />,
  'payments-non-tax-payments-to-other-accounts': () => <DynAccountPayment title="Payments to Other Accounts" modeValue="Bank" storageKey="payments-other-nontax" moduleId="payments-non-tax-payments-to-other-accounts" statusText="NON-TAX PAYMENT VOUCHER" />,
  'payments-non-tax-post-dated-cheques-issued': DynPDCIssued,

  // Receipts
  'receipts-bank-cash-receipts': DynReceipt,

  // Adjustments
  'adjustments-journal-vouchers': DynJournal,
  'adjustments-stock-adjustments': () => <DynStockModule title="Stock Adjustments" storageKey="stock-adjustments" moduleId="adjustments-stock-adjustments" extraFields={[{ label: 'Adjustment Type', type: 'select', options: ['Add', 'Reduce'] }]} />,

  // Store & Production
  'store-production-inward-gate-passes': () => <DynStockModule title="Inward Gate Passes" storageKey="store-inward-gate-passes" moduleId="store-production-inward-gate-passes" />,
  'store-production-goods-received-notes': () => <DynStockModule title="Goods Received Notes" storageKey="store-goods-received-notes" moduleId="store-production-goods-received-notes" />,
  'store-production-delivery-notes': () => <DynStockModule title="Delivery Notes" storageKey="store-delivery-notes" moduleId="store-production-delivery-notes" extraFields={[{ label: 'Adjustment Type', type: 'select', options: ['Add', 'Reduce'] }]} />,
  'store-production-outwards-gate-passes': () => <DynStockModule title="Outwards Gate Passes" storageKey="store-outwards-gate-passes" moduleId="store-production-outwards-gate-passes" />,
  'store-production-bill-of-materials': () => <DynStockModule title="Bill of Materials" storageKey="store-bill-of-materials" moduleId="store-production-bill-of-materials" />,
  'store-production-material-issue-notes': () => <DynStockModule title="Material Issue Notes" storageKey="store-material-issue-notes" moduleId="store-production-material-issue-notes" />,
  'store-production-production-notes': () => <DynStockModule title="Production Notes" storageKey="store-production-notes" moduleId="store-production-production-notes" />,
  'store-production-production-and-assembly': () => <DynStockModule title="Production and Assembly" storageKey="store-production-assembly" moduleId="store-production-production-and-assembly" />,
  'store-production-add-inventory-adjustments': () => <DynStockModule title="Add Inventory Adjustments" storageKey="store-add-inventory" moduleId="store-production-add-inventory-adjustments" />,
  'store-production-reduce-inventory-adjustments': () => <DynStockModule title="Reduce Inventory Adjustments" storageKey="store-reduce-inventory" moduleId="store-production-reduce-inventory-adjustments" />,
  'store-production-inventory-transfers': () => <DynStockModule title="Inventory Transfers" storageKey="store-inventory-transfers" moduleId="store-production-inventory-transfers" />,

  // Reports
  'reports-user-log-report': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-user-log-report" title="User Log Report" /></LazyModuleBoundary>,
  'reports-general-journal-detail': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-general-journal-detail" title="General Journal Detail" /></LazyModuleBoundary>,
  'reports-purchases-report': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-purchases-report" title="Purchases Report" /></LazyModuleBoundary>,
  'reports-sales-report': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-sales-report" title="Sales Report" /></LazyModuleBoundary>,
  'reports-payments-report': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-payments-report" title="Payments Report" /></LazyModuleBoundary>,
  'reports-receipts-report': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-receipts-report" title="Receipts Report" /></LazyModuleBoundary>,
  'reports-productions-report': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-productions-report" title="Productions Report" /></LazyModuleBoundary>,
  'reports-product-serial-tracking': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-product-serial-tracking" title="Product Serial Tracking" /></LazyModuleBoundary>,
  'reports-products-ledgers': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-products-ledgers" title="Products Ledgers" /></LazyModuleBoundary>,
  'reports-products-activity-report': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-products-activity-report" title="Products Activity Report" /></LazyModuleBoundary>,
  'reports-products-balances': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-products-balances" title="Products Balances" /></LazyModuleBoundary>,
  'reports-services-ledgers': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-services-ledgers" title="Services Ledgers" /></LazyModuleBoundary>,
  'reports-jobs-projects-ledgers': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-jobs-projects-ledgers" title="Jobs/Projects Ledgers" /></LazyModuleBoundary>,
  'reports-jobs-project-summary': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-jobs-project-summary" title="Jobs/Project Summary" /></LazyModuleBoundary>,
  'reports-account-ledgers': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-account-ledgers" title="Account Ledgers" /></LazyModuleBoundary>,
  'reports-account-balances': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-account-balances" title="Account Balances" /></LazyModuleBoundary>,
  'reports-income-statement': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-income-statement" title="Income Statement" /></LazyModuleBoundary>,
  'reports-balance-sheet': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-balance-sheet" title="Balance Sheet" /></LazyModuleBoundary>,
  'reports-day-summary': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-day-summary" title="Day Summary" /></LazyModuleBoundary>,
  'reports-sales-analysis': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-sales-analysis" title="Sales Analysis" /></LazyModuleBoundary>,
  'reports-inventory-status': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-inventory-status" title="Inventory Status" /></LazyModuleBoundary>,
  'reports-accounts-receivable': () => <LazyModuleBoundary><SmartReportsModule reportId="reports-accounts-receivable" title="Accounts Receivable" /></LazyModuleBoundary>,
  'reminders-notes': () => <LazyModuleBoundary><Reminders /></LazyModuleBoundary>,
};
