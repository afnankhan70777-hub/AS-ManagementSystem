import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { LEARNING_COLLECTION_SEEDS } from './learningSeed.generated.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PLATFORM_OWNER_USERNAME = 'platform';
const PLATFORM_OWNER_PASSWORD = 'platform';
const PLATFORM_OWNER_EMAIL = 'platform@local';
const PLATFORM_OWNER_NAME = 'Platform Owner';
const PLATFORM_OWNER_ROLE = 'Platform Owner';
const CLIENT_ADMIN_ROLE = 'Client Admin';
const EMPLOYEE_ROLES = new Set(['Manager', 'Accountant', 'Operator', 'Viewer']);
const DEFAULT_PREFERENCES = {
  bigCurrency: 'Rupees',
  smallCurrency: 'Paisas',
  symbol: 'PKR',
  dateFormat: 'DD/MM/YYYY',
  defaultTax: 17,
  defaultWarehouse: 'Main Store',
  fedDesc: 'F.E.D.',
  fedSalesTax: 'Sales Tax',
  stateSalesTax: 'Sales Tax',
  extraTax: 'Extra Tax',
  furtherTax: 'Further Tax',
  furtherTaxRate: 3,
  qtyDec: 2,
  rateDec: 2,
  qtyProd: 6,
  rateProd: 6,
  gridLines: true,
  printLogo: true,
  autoBackup: false,
  ledgerDesc: true,
  invMovement: 'Purchase Invoices & Sale Invoices',
  colHSCode: false,
  colModel: false,
  colSize: false,
  colColour: false,
  colBatch: true,
  colMfgDate: false,
  colAddQty: false,
  colDefQty: true,
  colDefQtyName: 'Pcs',
  colFocPacks: false,
  colFocPcs: false,
  colUnit: true,
  colPacking: false,
  colMRP: false,
  colSalesTax: true,
  colFED: false,
  colExtraTax: true,
  colFurtherTax: true,
  colDiscount: true,
} as const;

const REFERENCE_COLLECTION_SEEDS: Record<string, Array<Record<string, unknown>>> = {
  'account-statement-components': [
    { id: 'statement-assets', name: 'Assets', sortOrder: 10 },
    { id: 'statement-liabilities', name: 'Liabilities', sortOrder: 20 },
    { id: 'statement-equity', name: 'Equity', sortOrder: 30 },
    { id: 'statement-revenue', name: 'Revenue', sortOrder: 40 },
    { id: 'statement-expenses', name: 'Expenses', sortOrder: 50 },
  ],
  'account-parent-types': [
    { id: 'parent-110', code: '110', name: 'Cash & Cash Equivalents', statementComponentId: 'statement-assets' },
    { id: 'parent-120', code: '120', name: 'Receivables & Advances', statementComponentId: 'statement-assets' },
    { id: 'parent-130', code: '130', name: 'Inventory & Stores', statementComponentId: 'statement-assets' },
    { id: 'parent-140', code: '140', name: 'Fixed Assets', statementComponentId: 'statement-assets' },
    { id: 'parent-210', code: '210', name: 'Current Liabilities', statementComponentId: 'statement-liabilities' },
    { id: 'parent-220', code: '220', name: 'Taxes & Duties', statementComponentId: 'statement-liabilities' },
    { id: 'parent-230', code: '230', name: 'Long Term Liabilities', statementComponentId: 'statement-liabilities' },
    { id: 'parent-310', code: '310', name: 'Owner Equity', statementComponentId: 'statement-equity' },
    { id: 'parent-320', code: '320', name: 'Reserves & Retained Earnings', statementComponentId: 'statement-equity' },
    { id: 'parent-410', code: '410', name: 'Sales Revenue', statementComponentId: 'statement-revenue' },
    { id: 'parent-420', code: '420', name: 'Other Income', statementComponentId: 'statement-revenue' },
    { id: 'parent-510', code: '510', name: 'Cost of Sales', statementComponentId: 'statement-expenses' },
    { id: 'parent-520', code: '520', name: 'Operating Expenses', statementComponentId: 'statement-expenses' },
    { id: 'parent-530', code: '530', name: 'Finance & Other Charges', statementComponentId: 'statement-expenses' },
  ],
  'account-sub-types': [
    { id: 'sub-11001', code: '11001', name: 'Cash in Hand', parentTypeId: 'parent-110' },
    { id: 'sub-11002', code: '11002', name: 'Bank Accounts', parentTypeId: 'parent-110' },
    { id: 'sub-12001', code: '12001', name: 'Trade Receivables', parentTypeId: 'parent-120' },
    { id: 'sub-12002', code: '12002', name: 'Staff Advances', parentTypeId: 'parent-120' },
    { id: 'sub-13001', code: '13001', name: 'Raw Material Inventory', parentTypeId: 'parent-130' },
    { id: 'sub-13002', code: '13002', name: 'Finished Goods Inventory', parentTypeId: 'parent-130' },
    { id: 'sub-14001', code: '14001', name: 'Office Equipment', parentTypeId: 'parent-140' },
    { id: 'sub-14002', code: '14002', name: 'Vehicles', parentTypeId: 'parent-140' },
    { id: 'sub-21001', code: '21001', name: 'Trade Payables', parentTypeId: 'parent-210' },
    { id: 'sub-21002', code: '21002', name: 'Accrued Expenses', parentTypeId: 'parent-210' },
    { id: 'sub-22001', code: '22001', name: 'Sales Tax Payable', parentTypeId: 'parent-220' },
    { id: 'sub-22002', code: '22002', name: 'Withholding Tax Payable', parentTypeId: 'parent-220' },
    { id: 'sub-23001', code: '23001', name: 'Bank Loans', parentTypeId: 'parent-230' },
    { id: 'sub-23002', code: '23002', name: 'Lease Obligations', parentTypeId: 'parent-230' },
    { id: 'sub-31001', code: '31001', name: 'Capital Account', parentTypeId: 'parent-310' },
    { id: 'sub-31002', code: '31002', name: 'Drawings Account', parentTypeId: 'parent-310' },
    { id: 'sub-32001', code: '32001', name: 'Retained Earnings', parentTypeId: 'parent-320' },
    { id: 'sub-32002', code: '32002', name: 'Capital Reserves', parentTypeId: 'parent-320' },
    { id: 'sub-41001', code: '41001', name: 'Product Sales', parentTypeId: 'parent-410' },
    { id: 'sub-41002', code: '41002', name: 'Service Revenue', parentTypeId: 'parent-410' },
    { id: 'sub-42001', code: '42001', name: 'Discount Received', parentTypeId: 'parent-420' },
    { id: 'sub-42002', code: '42002', name: 'Miscellaneous Income', parentTypeId: 'parent-420' },
    { id: 'sub-51001', code: '51001', name: 'Purchase Expense', parentTypeId: 'parent-510' },
    { id: 'sub-51002', code: '51002', name: 'Direct Labor', parentTypeId: 'parent-510' },
    { id: 'sub-52001', code: '52001', name: 'Administrative Expenses', parentTypeId: 'parent-520' },
    { id: 'sub-52002', code: '52002', name: 'Selling Expenses', parentTypeId: 'parent-520' },
    { id: 'sub-53001', code: '53001', name: 'Bank Charges', parentTypeId: 'parent-530' },
    { id: 'sub-53002', code: '53002', name: 'Depreciation Expense', parentTypeId: 'parent-530' },
  ],
  accounts: [
    { id: '1', code: '110010001', name: 'Cash in Hand', type: 'Assets', subType: 'Cash in Hand', balance: 250000, notes: 'Default cash account', statementComponentId: 'statement-assets', statementComponent: 'Assets', parentTypeId: 'parent-110', parentTypeCode: '110', parentTypeName: 'Cash & Cash Equivalents', subTypeId: 'sub-11001', subTypeCode: '11001', status: 'Active' },
    { id: '2', code: '110020001', name: 'Bank Current Account', type: 'Assets', subType: 'Bank Accounts', balance: 850000, notes: 'Default bank account', statementComponentId: 'statement-assets', statementComponent: 'Assets', parentTypeId: 'parent-110', parentTypeCode: '110', parentTypeName: 'Cash & Cash Equivalents', subTypeId: 'sub-11002', subTypeCode: '11002', status: 'Active' },
    { id: '3', code: '120010001', name: 'Accounts Receivable', type: 'Assets', subType: 'Trade Receivables', balance: 0, notes: 'Default receivable account', statementComponentId: 'statement-assets', statementComponent: 'Assets', parentTypeId: 'parent-120', parentTypeCode: '120', parentTypeName: 'Receivables & Advances', subTypeId: 'sub-12001', subTypeCode: '12001', status: 'Active' },
    { id: '4', code: '210010001', name: 'Accounts Payable', type: 'Liabilities', subType: 'Trade Payables', balance: 0, notes: 'Default payable account', statementComponentId: 'statement-liabilities', statementComponent: 'Liabilities', parentTypeId: 'parent-210', parentTypeCode: '210', parentTypeName: 'Current Liabilities', subTypeId: 'sub-21001', subTypeCode: '21001', status: 'Active' },
    { id: '5', code: '410010001', name: 'Sales Revenue', type: 'Revenue', subType: 'Product Sales', balance: 0, notes: 'Default sales revenue account', statementComponentId: 'statement-revenue', statementComponent: 'Revenue', parentTypeId: 'parent-410', parentTypeCode: '410', parentTypeName: 'Sales Revenue', subTypeId: 'sub-41001', subTypeCode: '41001', status: 'Active' },
    { id: '6', code: '510010001', name: 'Cost of Sales', type: 'Expenses', subType: 'Purchase Expense', balance: 0, notes: 'Default cost account', statementComponentId: 'statement-expenses', statementComponent: 'Expenses', parentTypeId: 'parent-510', parentTypeCode: '510', parentTypeName: 'Cost of Sales', subTypeId: 'sub-51001', subTypeCode: '51001', status: 'Active' },
  ],
  vendors: [
    { id: '1', code: '001', name: 'ABC Suppliers', type: 'Local Vendors', contact: 'Ahmed', contactNo: '0301-1234567', email: 'abc@email.com', address: 'Lahore', creditDays: 30, creditLimit: 500000, ntn: '1234567-8', cnic: '35201-1234567-8', strn: '12-34-5678-901-23' },
    { id: '2', code: '002', name: 'XYZ Traders', type: 'Import Vendors', contact: 'Ali', contactNo: '0321-7654321', email: 'xyz@email.com', address: 'Karachi', creditDays: 15, creditLimit: 300000, ntn: '2345678-9', cnic: '42201-2345678-9', strn: '23-45-6789-012-34' },
    { id: '3', code: '003', name: 'Global Imports', type: 'Import Vendors', contact: 'Hassan', contactNo: '0333-9876543', email: 'global@email.com', address: 'Islamabad', creditDays: 45, creditLimit: 1000000, ntn: '3456789-0', cnic: '44201-3456789-0', strn: '34-56-7890-123-45' },
  ],
  customers: [
    { id: '1', code: '001', name: 'Nadeem Fabrics', type: 'Wholesale', region: 'Lahore', contact: 'Nadeem', contactNo: '0300-1112233', email: 'nadeem@email.com', address: 'Anarkali, Lahore', creditDays: 30, creditLimit: 500000, ntn: '1111111-1', strn: '11-11-1111-111-11' },
    { id: '2', code: '002', name: 'City Electronics', type: 'Retail', region: 'Karachi', contact: 'Farhan', contactNo: '0321-4445566', email: 'city@email.com', address: 'Saddar, Karachi', creditDays: 15, creditLimit: 300000, ntn: '2222222-2', strn: '22-22-2222-222-22' },
    { id: '3', code: '003', name: 'Govt School', type: 'Institutional', region: 'Islamabad', contact: 'Principal', contactNo: '051-1234567', email: 'school@email.com', address: 'G-10, Islamabad', creditDays: 60, creditLimit: 1000000, ntn: '3333333-3', strn: '33-33-3333-333-33' },
  ],
  products: [
    { id: '1', code: '1001000008', name: 'Adams Cheese', category: 'Dairy', subCategory: 'Cheese', unit: 'Pcs', pcsPerPack: 12, hscode: '0406.90', model: 'AC-12', size: '1 KG', colour: 'Cream', batch: 'CH-2401', mfgDate: '01/02/2026', packing: '12 x 1 KG Carton', mrp: 1450, cost: 1170, price1: 1300, price2: 1280, price3: 1260, price4: 1250, price5: 1240 },
    { id: '2', code: '1000000006', name: 'Sunsilk Shampoo', category: 'Personal Care', subCategory: 'Shampoo', unit: 'Pcs', pcsPerPack: 24, hscode: '3305.10', model: 'SS-650', size: '650 ML', colour: 'Black', batch: 'SS-2402', mfgDate: '12/01/2026', packing: '24 x 650 ML', mrp: 999, cost: 850, price1: 950, price2: 930, price3: 920, price4: 910, price5: 900 },
    { id: '3', code: '1003000045', name: 'Nestle Milk', category: 'Dairy', subCategory: 'Milk', unit: 'Pcs', pcsPerPack: 12, hscode: '0401.20', model: 'NM-1L', size: '1 LTR', colour: 'White', batch: 'ML-2404', mfgDate: '25/02/2026', packing: '12 x 1 LTR', mrp: 245, cost: 180, price1: 220, price2: 210, price3: 205, price4: 200, price5: 195 },
  ],
  'vendor-types': [
    { id: '1', name: 'Local Vendors' },
    { id: '2', name: 'Import Vendors' },
    { id: '3', name: 'Service Vendors' },
  ],
  'customer-types': [
    { id: '1', name: 'Wholesale' },
    { id: '2', name: 'Retail' },
    { id: '3', name: 'Institutional' },
    { id: '4', name: 'Government' },
  ],
  'customer-regions': [
    { id: '1', name: 'Lahore' },
    { id: '2', name: 'Karachi' },
    { id: '3', name: 'Islamabad' },
    { id: '4', name: 'Faisalabad' },
    { id: '5', name: 'Multan' },
    { id: '6', name: 'Peshawar' },
    { id: '7', name: 'Gujranwala' },
  ],
  'customer-groups-1': [
    { id: '1', name: 'Group A' },
    { id: '2', name: 'Group B' },
    { id: '3', name: 'Group C' },
  ],
  'customer-groups-2': [
    { id: '1', name: 'Sub Group 1' },
    { id: '2', name: 'Sub Group 2' },
  ],
  warehouses: [
    { id: '1', name: 'Main Store' },
    { id: '2', name: 'Godown 2' },
    { id: '3', name: 'Godown 3' },
  ],
  services: [
    { id: '1', name: 'Delivery Service' },
    { id: '2', name: 'Installation' },
    { id: '3', name: 'Consulting' },
  ],
  'service-categories': [
    { id: '1', name: 'Transport' },
    { id: '2', name: 'Consulting' },
    { id: '3', name: 'Maintenance' },
  ],
  'tax-rates': [
    { id: '1', name: 'Punjab - 16%' },
    { id: '2', name: 'Sindh - 13%' },
    { id: '3', name: 'KPK - 15%' },
    { id: '4', name: 'Baluchistan - 15%' },
    { id: '5', name: 'Islamabad - 17%' },
  ],
  'cost-centres': [
    { id: '1', name: 'Head Office' },
    { id: '2', name: 'Branch Lahore' },
    { id: '3', name: 'Branch Karachi' },
  ],
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function normalizeRole(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeOrganizationName(value: unknown) {
  return String(value || '').trim();
}

function slugifyForEmail(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'workspace';
}

function buildManagedEmail(username: string, scope: string) {
  return `${normalizeUsername(username)}@${slugifyForEmail(scope)}.asautomations.local`;
}

function isPlatformOwnerRole(role: unknown) {
  return normalizeRole(role) === 'platform owner';
}

function isClientAdminRole(role: unknown) {
  return normalizeRole(role) === 'client admin';
}

function isEmployeeRole(role: unknown) {
  return EMPLOYEE_ROLES.has(String(role || '').trim());
}

function extractBearerToken(authHeader: string | null) {
  if (!authHeader) {
    return '';
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || '').trim() : '';
}

async function findConflictingProfile(
  adminClient: ReturnType<typeof createClient>,
  username: string,
  email: string,
  excludeId = '',
) {
  const { data, error } = await adminClient
    .from('user_profiles')
    .select('id, username, email');

  if (error) {
    throw error;
  }

  const normalizedUsername = normalizeUsername(username);
  const normalizedEmail = String(email || '').trim().toLowerCase();

  const usernameConflict = data?.find((profile) => {
    if (excludeId && String(profile.id || '') === excludeId) {
      return false;
    }

    return normalizeUsername(profile.username) === normalizedUsername;
  });

  if (usernameConflict) {
    return { type: 'username' as const, profile: usernameConflict };
  }

  const emailConflict = data?.find((profile) => {
    if (excludeId && String(profile.id || '') === excludeId) {
      return false;
    }

    return String(profile.email || '').trim().toLowerCase() === normalizedEmail;
  });

  if (emailConflict) {
    return { type: 'email' as const, profile: emailConflict };
  }

  return null;
}

async function findOrganizationByName(adminClient: ReturnType<typeof createClient>, organizationName: string) {
  const normalizedName = normalizeOrganizationName(organizationName);
  if (!normalizedName) {
    return null;
  }

  const { data, error } = await adminClient
    .from('organizations')
    .select('id, name')
    .ilike('name', normalizedName)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function ensureOrganization(adminClient: ReturnType<typeof createClient>, organizationName: string) {
  const normalizedName = normalizeOrganizationName(organizationName);
  if (!normalizedName) {
    throw new Error('Business name is required');
  }

  const existing = await findOrganizationByName(adminClient, normalizedName);
  if (existing?.id) {
    return existing;
  }

  const { data, error } = await adminClient
    .from('organizations')
    .insert({ name: normalizedName, status: 'Active' })
    .select('id, name')
    .single();

  if (error || !data) {
    throw error || new Error('Unable to create business organization');
  }

  return data;
}

async function countOrganizationUsers(adminClient: ReturnType<typeof createClient>, organizationId: string) {
  const { count, error } = await adminClient
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId);

  if (error) {
    throw error;
  }

  return count || 0;
}

async function getOrganizationById(adminClient: ReturnType<typeof createClient>, organizationId: string) {
  if (!organizationId) {
    return null;
  }

  const { data, error } = await adminClient
    .from('organizations')
    .select('id, name')
    .eq('id', organizationId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function seedOrganizationWorkspace(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
  organizationName: string,
  createdBy: string,
) {
  const currentYear = new Date().getUTCFullYear();
  const bootstrapCollections: Record<string, Array<Record<string, unknown>>> = {
    ...LEARNING_COLLECTION_SEEDS,
    preferences: [
      {
        id: 'default-preferences',
        ...DEFAULT_PREFERENCES,
      },
    ],
    'company-setup': [
      {
        id: 'default-company-setup',
        companyName: organizationName,
        nick: 'Head Office',
        address: '',
        phone: '',
        email: '',
        website: '',
        ntn: '',
        strn: '',
      },
    ],
    'financial-years': [
      {
        id: `default-financial-year-${currentYear}`,
        startDate: `01/01/${currentYear}`,
        endDate: `31/12/${currentYear}`,
        status: 'Active',
      },
    ],
  };

  const rows = Object.entries(bootstrapCollections).flatMap(([collection, records]) =>
    records.map((record) => ({
      organization_id: organizationId,
      collection,
      record_id: String(record.id || crypto.randomUUID()),
      payload: record,
      created_by: createdBy,
      updated_by: createdBy,
    })),
  );

  if (rows.length === 0) {
    return;
  }

  const { error } = await adminClient.from('app_records').upsert(rows, {
    onConflict: 'organization_id,collection,record_id',
  });

  if (error) {
    throw error;
  }
}

async function seedWorkspaceFoundationsIfMissing(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
  organizationName: string,
  createdBy: string,
) {
  const currentYear = new Date().getUTCFullYear();
  const foundationCollections: Record<string, Array<Record<string, unknown>>> = {
    preferences: [
      {
        id: 'default-preferences',
        ...DEFAULT_PREFERENCES,
      },
    ],
    'company-setup': [
      {
        id: 'default-company-setup',
        companyName: organizationName,
        nick: 'Head Office',
        address: '',
        phone: '',
        email: '',
        website: '',
        ntn: '',
        strn: '',
      },
    ],
    'financial-years': [
      {
        id: `default-financial-year-${currentYear}`,
        startDate: `01/01/${currentYear}`,
        endDate: `31/12/${currentYear}`,
        status: 'Active',
      },
    ],
    'customer-types': REFERENCE_COLLECTION_SEEDS['customer-types'] || [],
    warehouses: REFERENCE_COLLECTION_SEEDS.warehouses || [],
  };

  for (const [collection, records] of Object.entries(foundationCollections)) {
    const { count, error: countError } = await adminClient
      .from('app_records')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('collection', collection);

    if (countError) {
      throw countError;
    }

    if ((count || 0) > 0 || records.length === 0) {
      continue;
    }

    const rows = records.map((record) => ({
      organization_id: organizationId,
      collection,
      record_id: String(record.id || crypto.randomUUID()),
      payload: record,
      created_by: createdBy,
      updated_by: createdBy,
    }));

    const { error: seedError } = await adminClient.from('app_records').upsert(rows, {
      onConflict: 'organization_id,collection,record_id',
    });

    if (seedError) {
      throw seedError;
    }
  }
}

async function seedWorkspaceFoundationsOnly(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
  organizationName: string,
  createdBy: string,
) {
  const currentYear = new Date().getUTCFullYear();
  const foundationCollections: Record<string, Array<Record<string, unknown>>> = {
    preferences: [
      {
        id: 'default-preferences',
        ...DEFAULT_PREFERENCES,
      },
    ],
    'company-setup': [
      {
        id: 'default-company-setup',
        companyName: organizationName,
        nick: 'Head Office',
        address: '',
        phone: '',
        email: '',
        website: '',
        ntn: '',
        strn: '',
      },
    ],
    'financial-years': [
      {
        id: `default-financial-year-${currentYear}`,
        startDate: `01/01/${currentYear}`,
        endDate: `31/12/${currentYear}`,
        status: 'Active',
      },
    ],
    'customer-types': REFERENCE_COLLECTION_SEEDS['customer-types'] || [],
    warehouses: REFERENCE_COLLECTION_SEEDS.warehouses || [],
  };

  const rows = Object.entries(foundationCollections).flatMap(([collection, records]) =>
    records.map((record) => ({
      organization_id: organizationId,
      collection,
      record_id: String(record.id || crypto.randomUUID()),
      payload: record,
      created_by: createdBy,
      updated_by: createdBy,
    })),
  );

  if (rows.length === 0) {
    return;
  }

  const { error } = await adminClient.from('app_records').upsert(rows, {
    onConflict: 'organization_id,collection,record_id',
  });

  if (error) {
    throw error;
  }
}

async function organizationWorkspaceNeedsSeed(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
) {
  if (!organizationId) {
    return false;
  }

  const { count, error } = await adminClient
    .from('app_records')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId);

  if (error) {
    throw error;
  }

  return (count || 0) === 0;
}

async function createUserProfile(
  adminClient: ReturnType<typeof createClient>,
  input: {
    id: string;
    username: string;
    fullName: string;
    email: string;
    role: string;
    status: string;
    organizationId?: string;
  },
) {
  const { error } = await adminClient.from('user_profiles').upsert({
    id: input.id,
    username: input.username,
    full_name: input.fullName,
    email: input.email,
    role: input.role,
    status: input.status,
    organization_id: input.organizationId || null,
  });

  if (error) {
    throw error;
  }
}

async function getProfileById(adminClient: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await adminClient
    .from('user_profiles')
    .select('id, username, email, role, organization_id')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function getProfileByUsername(adminClient: ReturnType<typeof createClient>, username: string) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return null;
  }

  const { data, error } = await adminClient
    .from('user_profiles')
    .select('id, username, role, organization_id')
    .ilike('username', normalizedUsername)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function fetchUserRightsRecord(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
  username: string,
) {
  const normalizedUsername = normalizeUsername(username);
  if (!organizationId || !normalizedUsername) {
    return null;
  }

  const { data, error } = await adminClient
    .from('app_records')
    .select('record_id, payload')
    .eq('organization_id', organizationId)
    .eq('collection', 'user-rights')
    .eq('record_id', normalizedUsername)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function upsertUserRightsRecord(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
  username: string,
  rightsData: Record<string, boolean>,
  actorUserId: string,
) {
  const normalizedUsername = normalizeUsername(username);
  if (!organizationId || !normalizedUsername) {
    throw new Error('Target organization and username are required');
  }

  const payload = {
    id: normalizedUsername,
    username: normalizedUsername,
    data: rightsData,
  };

  const { error } = await adminClient
    .from('app_records')
    .upsert({
      organization_id: organizationId,
      collection: 'user-rights',
      record_id: normalizedUsername,
      payload,
      created_by: actorUserId,
      updated_by: actorUserId,
    }, {
      onConflict: 'organization_id,collection,record_id',
    });

  if (error) {
    throw error;
  }

  return payload;
}

async function resolveLoginProfile(adminClient: ReturnType<typeof createClient>, loginValue: string) {
  const normalizedLogin = String(loginValue || '').trim().toLowerCase();
  if (!normalizedLogin) {
    return null;
  }

  const { data, error } = await adminClient
    .from('user_profiles')
    .select('id, username, full_name, email, role, status, organization_id')
    .or(`username.ilike.${normalizedLogin},email.ilike.${normalizedLogin}`)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function fetchSnapshotUserLogins(
  adminClient: ReturnType<typeof createClient>,
  callerProfile: { id: string; role: string; organization_id?: string | null },
) {
  const callerIsPlatformOwner = isPlatformOwnerRole(callerProfile.role);
  const callerOrganizationId = String(callerProfile.organization_id || '').trim();

  let profileQuery = adminClient
    .from('user_profiles')
    .select('id, username, full_name, email, role, status, organization_id')
    .order('username', { ascending: true });

  if (!callerIsPlatformOwner && callerOrganizationId) {
    profileQuery = profileQuery.eq('organization_id', callerOrganizationId);
  }

  const [{ data: profiles, error: profilesError }, { data: organizations, error: organizationsError }] = await Promise.all([
    profileQuery,
    adminClient.from('organizations').select('id, name').order('name', { ascending: true }),
  ]);

  if (profilesError) {
    throw profilesError;
  }

  if (organizationsError) {
    throw organizationsError;
  }

  const organizationNames = new Map(
    ((organizations || []) as Array<{ id?: string | null; name?: string | null }>)
      .map((organization) => [String(organization.id || ''), String(organization.name || '')]),
  );

  return ((profiles || []) as Array<Record<string, unknown>>).map((profile) => ({
    id: String(profile.id || ''),
    username: String(profile.username || ''),
    fullName: String(profile.full_name || ''),
    email: String(profile.email || ''),
    role: String(profile.role || ''),
    status: String(profile.status || 'Active'),
    organizationId: String(profile.organization_id || ''),
    organizationName: String(profile.organization_id ? organizationNames.get(String(profile.organization_id || '')) || '' : ''),
  }));
}

async function fetchSnapshotAppRecords(
  adminClient: ReturnType<typeof createClient>,
  callerProfile: { role: string; organization_id?: string | null },
) {
  const callerIsPlatformOwner = isPlatformOwnerRole(callerProfile.role);
  const callerOrganizationId = String(callerProfile.organization_id || '').trim();

  if (!callerOrganizationId) {
    return [];
  }

  const { data, error } = await adminClient
    .from('app_records')
    .select('collection, record_id, payload')
    .eq('organization_id', callerOrganizationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []) as Array<{ collection?: string | null; record_id?: string | null; payload?: Record<string, unknown> | null }>;
}

async function buildCloudSnapshot(
  adminClient: ReturnType<typeof createClient>,
  callerProfile: { id: string; role: string; organization_id?: string | null },
) {
  const userLogins = await fetchSnapshotUserLogins(adminClient, callerProfile);
  const appRecords = await fetchSnapshotAppRecords(adminClient, callerProfile);
  const snapshot: Record<string, Array<Record<string, unknown>>> = {
    'user-logins': userLogins,
  };

  appRecords.forEach((row) => {
    const collection = String(row.collection || '').trim();
    if (!collection) {
      return;
    }

    if (!snapshot[collection]) {
      snapshot[collection] = [];
    }

    snapshot[collection].push({
      ...(row.payload || {}),
      id: String(row.record_id || ''),
      __collection: collection,
    });
  });

  return snapshot;
}

function resolveTargetOrganizationId(
  callerProfile: { role: string; organization_id?: string | null },
  payload: Record<string, unknown>,
) {
  const requestedOrganizationId = String(payload.organizationId || '').trim();
  if (isPlatformOwnerRole(callerProfile.role)) {
    return requestedOrganizationId;
  }

  return String(callerProfile.organization_id || '').trim();
}

async function clearUserAuditReferences(adminClient: ReturnType<typeof createClient>, id: string) {
  const { error: clearCreatedByError } = await adminClient
    .from('app_records')
    .update({ created_by: null })
    .eq('created_by', id);

  if (clearCreatedByError) {
    throw clearCreatedByError;
  }

  const { error: clearUpdatedByError } = await adminClient
    .from('app_records')
    .update({ updated_by: null })
    .eq('updated_by', id);

  if (clearUpdatedByError) {
    throw clearUpdatedByError;
  }
}

async function countUserAuditReferences(adminClient: ReturnType<typeof createClient>, id: string) {
  const { count: createdByCount, error: createdByCountError } = await adminClient
    .from('app_records')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', id);

  if (createdByCountError) {
    throw createdByCountError;
  }

  const { count: updatedByCount, error: updatedByCountError } = await adminClient
    .from('app_records')
    .select('id', { count: 'exact', head: true })
    .eq('updated_by', id);

  if (updatedByCountError) {
    throw updatedByCountError;
  }

  return {
    createdBy: createdByCount || 0,
    updatedBy: updatedByCount || 0,
  };
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = request.headers.get('Authorization');

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: 'Missing Supabase environment variables' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid request body' });
  }

  const action = String(payload.action || '').trim();
  const username = String(payload.username || '').trim();
  const normalizedUsername = normalizeUsername(username);
  const fullName = String(payload.fullName || '').trim();
  let email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '').trim();
  const role = String(payload.role || 'Operator').trim();
  const status = String(payload.status || 'Active').trim();
  const id = String(payload.id || '').trim();
  const organizationName = normalizeOrganizationName(payload.organizationName);
  const forceReset = Boolean(payload.forceReset);

  const { count: profileCount, error: countError } = await adminClient
    .from('user_profiles')
    .select('id', { count: 'exact', head: true });

  if (countError) {
    return jsonResponse(500, { error: countError.message });
  }

  if (action === 'bootstrap-platform-owner') {
    if ((profileCount || 0) > 0) {
      return jsonResponse(400, { error: 'Platform owner has already been initialized' });
    }

    const conflict = await findConflictingProfile(adminClient, PLATFORM_OWNER_USERNAME, PLATFORM_OWNER_EMAIL);
    if (conflict) {
      return jsonResponse(400, { error: 'Embedded platform owner credentials are already in use' });
    }

    const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
      email: PLATFORM_OWNER_EMAIL,
      password: PLATFORM_OWNER_PASSWORD,
      email_confirm: true,
      user_metadata: {
        username: PLATFORM_OWNER_USERNAME,
        fullName: PLATFORM_OWNER_NAME,
        role: PLATFORM_OWNER_ROLE,
        status: 'Active',
      },
    });

    if (createError || !createdUser.user) {
      return jsonResponse(400, { error: createError?.message || 'Unable to create platform owner' });
    }

    try {
      await createUserProfile(adminClient, {
        id: createdUser.user.id,
        username: PLATFORM_OWNER_USERNAME,
        fullName: PLATFORM_OWNER_NAME,
        email: PLATFORM_OWNER_EMAIL,
        role: PLATFORM_OWNER_ROLE,
        status: 'Active',
      });
    } catch (error) {
      await adminClient.auth.admin.deleteUser(createdUser.user.id);
      return jsonResponse(400, { error: error instanceof Error ? error.message : 'Unable to store platform owner profile' });
    }

    return jsonResponse(200, { success: true, id: createdUser.user.id });
  }

  if (action === 'resolve-login-identity') {
    const loginValue = String(payload.login || payload.username || '').trim();
    if (!loginValue) {
      return jsonResponse(400, { error: 'Login is required' });
    }

    try {
      const profile = await resolveLoginProfile(adminClient, loginValue);
      if (!profile?.id) {
        return jsonResponse(200, { success: true, identity: null });
      }

      const { data: authUserData, error: authUserError } = await adminClient.auth.admin.getUserById(String(profile.id));
      if (authUserError || !authUserData.user) {
        return jsonResponse(200, {
          success: true,
          identity: {
            id: String(profile.id),
            username: String(profile.username || ''),
            fullName: String((profile as any).full_name || ''),
            email: String(profile.email || ''),
            role: String(profile.role || ''),
            status: String((profile as any).status || 'Active'),
            organizationId: (profile as any).organization_id ? String((profile as any).organization_id) : '',
            repaired: false,
          },
        });
      }

      const canonicalEmail = String(authUserData.user.email || profile.email || '').trim().toLowerCase();
      const organizationId = (profile as any).organization_id ? String((profile as any).organization_id) : '';
      let organizationName = '';

      if (organizationId) {
        const organization = await getOrganizationById(adminClient, organizationId);
        organizationName = String(organization?.name || '');
      }

      const normalizedRole = normalizeRole(profile.role);
      if (organizationId && normalizedRole === normalizeRole(CLIENT_ADMIN_ROLE)) {
        const needsSeed = await organizationWorkspaceNeedsSeed(adminClient, organizationId);
        if (needsSeed) {
          await seedOrganizationWorkspace(
            adminClient,
            organizationId,
            organizationName || String(profile.username || 'Business Workspace'),
            String(profile.id),
          );
        }
      }

      const profileEmail = String(profile.email || '').trim().toLowerCase();
      if (canonicalEmail && canonicalEmail !== profileEmail) {
        await adminClient
          .from('user_profiles')
          .update({ email: canonicalEmail })
          .eq('id', profile.id);
      }

      return jsonResponse(200, {
        success: true,
        identity: {
          id: String(profile.id),
          username: String(profile.username || ''),
          fullName: String((profile as any).full_name || ''),
          email: canonicalEmail || profileEmail,
          role: String(profile.role || ''),
          status: String((profile as any).status || 'Active'),
          organizationId,
          organizationName,
          repaired: canonicalEmail !== profileEmail,
        },
      });
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to resolve login identity' });
    }
  }

  if (!authHeader) {
    return jsonResponse(401, { error: 'Missing authorization header' });
  }

  const accessToken = extractBearerToken(authHeader);
  if (!accessToken) {
    return jsonResponse(401, { error: 'Invalid authorization header' });
  }

  const { data: authData, error: authError } = await adminClient.auth.getUser(accessToken);
  if (authError || !authData.user) {
    return jsonResponse(401, { error: 'Invalid user session' });
  }

  const { data: callerProfile, error: profileError } = await adminClient
    .from('user_profiles')
    .select('id, role, organization_id')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError || !callerProfile) {
    return jsonResponse(403, { error: 'Only authorized users can manage users' });
  }

  const callerIsPlatformOwner = isPlatformOwnerRole(callerProfile.role);
  const callerIsClientAdmin = isClientAdminRole(callerProfile.role);

  if (action === 'fetch-cloud-snapshot') {
    try {
      const snapshot = await buildCloudSnapshot(adminClient, callerProfile as { id: string; role: string; organization_id?: string | null });
      return jsonResponse(200, { success: true, snapshot });
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to load cloud snapshot' });
    }
  }

  if (action === 'upsert-cloud-record') {
    const targetOrganizationId = resolveTargetOrganizationId(callerProfile as { role: string; organization_id?: string | null }, payload);
    const collection = String(payload.collection || '').trim();
    const record = payload.record && typeof payload.record === 'object' && !Array.isArray(payload.record)
      ? payload.record as Record<string, unknown>
      : null;

    if (!targetOrganizationId || !collection || !record) {
      return jsonResponse(400, { error: 'Organization id, collection, and record are required' });
    }

    const recordId = String(record.id || '').trim();
    if (!recordId) {
      return jsonResponse(400, { error: 'Record id is required' });
    }

    const { id: _id, __collection: _collection, ...recordPayload } = record;
    const { error } = await adminClient.from('app_records').upsert({
      organization_id: targetOrganizationId,
      collection,
      record_id: recordId,
      payload: recordPayload,
      created_by: authData.user.id,
      updated_by: authData.user.id,
    }, {
      onConflict: 'organization_id,collection,record_id',
    });

    if (error) {
      return jsonResponse(500, { error: error.message });
    }

    return jsonResponse(200, { success: true, collection, id: recordId });
  }

  if (action === 'delete-cloud-record') {
    const targetOrganizationId = resolveTargetOrganizationId(callerProfile as { role: string; organization_id?: string | null }, payload);
    const collection = String(payload.collection || '').trim();
    const recordId = String(payload.id || '').trim();

    if (!targetOrganizationId || !collection || !recordId) {
      return jsonResponse(400, { error: 'Organization id, collection, and record id are required' });
    }

    const { error } = await adminClient
      .from('app_records')
      .delete()
      .eq('organization_id', targetOrganizationId)
      .eq('collection', collection)
      .eq('record_id', recordId);

    if (error) {
      return jsonResponse(500, { error: error.message });
    }

    return jsonResponse(200, { success: true, collection, id: recordId });
  }

  if (action === 'replace-cloud-collection') {
    const targetOrganizationId = resolveTargetOrganizationId(callerProfile as { role: string; organization_id?: string | null }, payload);
    const collection = String(payload.collection || '').trim();
    const records = Array.isArray(payload.records) ? payload.records as Array<Record<string, unknown>> : [];

    if (!targetOrganizationId || !collection) {
      return jsonResponse(400, { error: 'Organization id and collection are required' });
    }

    const { error: deleteError } = await adminClient
      .from('app_records')
      .delete()
      .eq('organization_id', targetOrganizationId)
      .eq('collection', collection);

    if (deleteError) {
      return jsonResponse(500, { error: deleteError.message });
    }

    if (records.length === 0) {
      return jsonResponse(200, { success: true, collection, count: 0 });
    }

    const rows = records.map((record) => {
      const { id: rawId, __collection: _collection, ...recordPayload } = record;
      return {
        organization_id: targetOrganizationId,
        collection,
        record_id: String(rawId || crypto.randomUUID()),
        payload: recordPayload,
        created_by: authData.user.id,
        updated_by: authData.user.id,
      };
    });

    const { error: insertError } = await adminClient.from('app_records').insert(rows);
    if (insertError) {
      return jsonResponse(500, { error: insertError.message });
    }

    return jsonResponse(200, { success: true, collection, count: rows.length });
  }

  if (!callerIsPlatformOwner && !callerIsClientAdmin) {
    return jsonResponse(403, { error: 'Only platform owner or client admin can manage users' });
  }

  if (action === 'check-username') {
    if (!normalizedUsername) {
      return jsonResponse(400, { error: 'Username is required' });
    }

    try {
      const conflict = await findConflictingProfile(adminClient, normalizedUsername, '');
      return jsonResponse(200, { success: true, available: !conflict });
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to check username availability' });
    }
  }

  if (action === 'fetch-user-rights') {
    if (!normalizedUsername) {
      return jsonResponse(400, { error: 'Username is required' });
    }

    let targetProfile;
    try {
      targetProfile = await getProfileByUsername(adminClient, normalizedUsername);
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to load target user' });
    }

    if (!targetProfile?.id) {
      return jsonResponse(404, { error: 'User not found' });
    }

    const targetOrganizationId = String(targetProfile.organization_id || '');
    if (!targetOrganizationId) {
      return jsonResponse(400, { error: 'Target user is not linked to a business organization' });
    }

    if (!callerIsPlatformOwner) {
      const callerOrganizationId = String(callerProfile.organization_id || '');
      if (!callerOrganizationId || callerOrganizationId !== targetOrganizationId) {
        return jsonResponse(403, { error: 'You can only manage rights for users in your own business' });
      }
    } else if (isPlatformOwnerRole(targetProfile.role)) {
      return jsonResponse(400, { error: 'Platform owner rights are not managed from this screen' });
    }

    try {
      const existingRecord = await fetchUserRightsRecord(adminClient, targetOrganizationId, normalizedUsername);
      return jsonResponse(200, {
        success: true,
        record: existingRecord
          ? {
            id: String((existingRecord as any).record_id || normalizedUsername),
            username: normalizedUsername,
            data: (((existingRecord as any).payload || {}) as Record<string, unknown>).data || {},
          }
          : null,
      });
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to load user rights' });
    }
  }

  if (action === 'save-user-rights') {
    if (!normalizedUsername) {
      return jsonResponse(400, { error: 'Username is required' });
    }

    const rightsData = payload.data;
    if (!rightsData || typeof rightsData !== 'object' || Array.isArray(rightsData)) {
      return jsonResponse(400, { error: 'Rights data is required' });
    }

    let targetProfile;
    try {
      targetProfile = await getProfileByUsername(adminClient, normalizedUsername);
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to load target user' });
    }

    if (!targetProfile?.id) {
      return jsonResponse(404, { error: 'User not found' });
    }

    const targetOrganizationId = String(targetProfile.organization_id || '');
    if (!targetOrganizationId) {
      return jsonResponse(400, { error: 'Target user is not linked to a business organization' });
    }

    if (!callerIsPlatformOwner) {
      const callerOrganizationId = String(callerProfile.organization_id || '');
      if (!callerOrganizationId || callerOrganizationId !== targetOrganizationId) {
        return jsonResponse(403, { error: 'You can only manage rights for users in your own business' });
      }
    } else if (isPlatformOwnerRole(targetProfile.role)) {
      return jsonResponse(400, { error: 'Platform owner rights are not managed from this screen' });
    }

    try {
      const record = await upsertUserRightsRecord(
        adminClient,
        targetOrganizationId,
        normalizedUsername,
        rightsData as Record<string, boolean>,
        authData.user.id,
      );
      return jsonResponse(200, { success: true, record });
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to save user rights' });
    }
  }

  if (action === 'create-user') {
    if (!normalizedUsername || !fullName || !password) {
      return jsonResponse(400, { error: 'Username, full name, and password are required' });
    }

    let targetOrganizationId = '';
    let emailScope = 'workspace';
    let targetOrganizationName = '';

    if (callerIsPlatformOwner) {
      if (!isClientAdminRole(role)) {
        return jsonResponse(400, { error: 'Platform owner can only create client admin accounts' });
      }

      try {
        const organization = await ensureOrganization(adminClient, organizationName);
        targetOrganizationId = String(organization.id || '');
        targetOrganizationName = String(organization.name || organizationName || '');
        emailScope = String(organization.name || organizationName || targetOrganizationId || 'workspace');
      } catch (error) {
        return jsonResponse(400, { error: error instanceof Error ? error.message : 'Unable to create business organization' });
      }
    } else {
      if (!isEmployeeRole(role)) {
        return jsonResponse(400, { error: 'Client admin can only create employee accounts' });
      }

      targetOrganizationId = String(callerProfile.organization_id || '');
      if (!targetOrganizationId) {
        return jsonResponse(400, { error: 'Your account is not linked to a business organization' });
      }

      emailScope = targetOrganizationId;
    }

    if (!email) {
      email = buildManagedEmail(normalizedUsername, emailScope);
    }

    try {
      const conflict = await findConflictingProfile(adminClient, normalizedUsername, email);
      if (conflict?.type === 'username') {
        return jsonResponse(400, { error: 'Username already taken' });
      }

      if (conflict?.type === 'email') {
        return jsonResponse(400, { error: 'This e-mail is already in use' });
      }
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to validate user details' });
    }

    const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: normalizedUsername, fullName, role, status, organizationId: targetOrganizationId },
    });

    if (createError || !createdUser.user) {
      return jsonResponse(400, { error: createError?.message || 'Unable to create user' });
    }

    try {
      await createUserProfile(adminClient, {
        id: createdUser.user.id,
        username: normalizedUsername,
        fullName,
        email,
        role,
        status,
        organizationId: targetOrganizationId,
      });

      if (callerIsPlatformOwner && targetOrganizationId) {
        const organizationUserCount = await countOrganizationUsers(adminClient, targetOrganizationId);
        if (organizationUserCount <= 1) {
          await seedOrganizationWorkspace(
            adminClient,
            targetOrganizationId,
            targetOrganizationName || organizationName || emailScope,
            createdUser.user.id,
          );
        }
      }
    } catch (error) {
      await adminClient.auth.admin.deleteUser(createdUser.user.id);
      return jsonResponse(400, { error: error instanceof Error ? error.message : 'Unable to store user profile' });
    }

    return jsonResponse(200, { success: true, id: createdUser.user.id });
  }

  if (action === 'update-user') {
    if (!id || !normalizedUsername || !fullName) {
      return jsonResponse(400, { error: 'Id, username, and full name are required' });
    }

    let targetProfile;
    try {
      targetProfile = await getProfileById(adminClient, id);
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to load user profile' });
    }

    if (!targetProfile) {
      return jsonResponse(404, { error: 'User not found' });
    }

    let targetOrganizationId = String(targetProfile.organization_id || '');
    let emailScope = targetOrganizationId || 'workspace';

    if (callerIsPlatformOwner) {
      if (!isClientAdminRole(targetProfile.role) && !isClientAdminRole(role)) {
        return jsonResponse(400, { error: 'Platform owner can only update client admin accounts' });
      }

      try {
        const organization = await ensureOrganization(adminClient, organizationName);
        targetOrganizationId = String(organization.id || '');
        emailScope = String(organization.name || organizationName || targetOrganizationId || 'workspace');
      } catch (error) {
        return jsonResponse(400, { error: error instanceof Error ? error.message : 'Unable to resolve business organization' });
      }
    } else {
      const callerOrganizationId = String(callerProfile.organization_id || '');
      if (!callerOrganizationId || String(targetProfile.organization_id || '') !== callerOrganizationId) {
        return jsonResponse(403, { error: 'You can only update users from your own business' });
      }

      if (!isEmployeeRole(role) || isClientAdminRole(targetProfile.role) || isPlatformOwnerRole(targetProfile.role)) {
        return jsonResponse(400, { error: 'Client admin can only update employee accounts' });
      }

      targetOrganizationId = callerOrganizationId;
      emailScope = callerOrganizationId;
    }

    if (!email) {
      email = buildManagedEmail(normalizedUsername, emailScope);
    }

    try {
      const conflict = await findConflictingProfile(adminClient, normalizedUsername, email, id);
      if (conflict?.type === 'username') {
        return jsonResponse(400, { error: 'Username already taken' });
      }

      if (conflict?.type === 'email') {
        return jsonResponse(400, { error: 'This e-mail is already in use' });
      }
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to validate user details' });
    }

    const updatePayload: Record<string, unknown> = {
      email,
      user_metadata: { username: normalizedUsername, fullName, role, status, organizationId: targetOrganizationId },
      ban_duration: status === 'Inactive' ? '876000h' : 'none',
    };

    if (password) {
      updatePayload.password = password;
    }

    const { error: updateUserError } = await adminClient.auth.admin.updateUserById(id, updatePayload);
    if (updateUserError) {
      return jsonResponse(400, { error: updateUserError.message });
    }

    try {
      await createUserProfile(adminClient, {
        id,
        username: normalizedUsername,
        fullName,
        email,
        role,
        status,
        organizationId: targetOrganizationId,
      });
    } catch (error) {
      return jsonResponse(400, { error: error instanceof Error ? error.message : 'Unable to update user profile' });
    }

    return jsonResponse(200, { success: true, id });
  }

  if (action === 'delete-user') {
    if (!id) {
      return jsonResponse(400, { error: 'Id is required' });
    }

    if (id === authData.user.id) {
      if (!forceReset || (profileCount || 0) !== 1) {
        return jsonResponse(400, { error: 'You cannot delete your own account' });
      }
    }

    let targetProfile;
    try {
      targetProfile = await getProfileById(adminClient, id);
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to load user profile' });
    }

    if (!targetProfile) {
      return jsonResponse(404, { error: 'User not found' });
    }

    if (callerIsPlatformOwner) {
      if (isPlatformOwnerRole(targetProfile.role)) {
        return jsonResponse(400, { error: 'Platform owner cannot delete another platform owner account' });
      }
    } else {
      const callerOrganizationId = String(callerProfile.organization_id || '');
      if (!callerOrganizationId || String(targetProfile.organization_id || '') !== callerOrganizationId) {
        return jsonResponse(403, { error: 'You can only delete users from your own business' });
      }

      if (!isEmployeeRole(targetProfile.role)) {
        return jsonResponse(400, { error: 'Client admin can only delete employee accounts' });
      }
    }

    try {
      await clearUserAuditReferences(adminClient, id);
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to clear user record ownership' });
    }

    let remainingAuditReferences;
    try {
      remainingAuditReferences = await countUserAuditReferences(adminClient, id);
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to verify cleared user record ownership' });
    }

    if (remainingAuditReferences.createdBy > 0 || remainingAuditReferences.updatedBy > 0) {
      return jsonResponse(500, {
        error: 'Unable to release user audit references before delete',
        references: remainingAuditReferences,
      });
    }

    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(id);
    if (deleteUserError) {
      return jsonResponse(400, {
        error: deleteUserError.message,
        references: remainingAuditReferences,
      });
    }

    await adminClient.from('user_profiles').delete().eq('id', id);
    return jsonResponse(200, { success: true, id });
  }

  if (action === 'prepare-workspace') {
    let targetOrganizationId = '';
    let targetOrganizationName = '';
    const includeDemoData = Boolean(payload.includeDemoData);

    if (callerIsPlatformOwner) {
      const requestedOrganizationId = String(payload.organizationId || '').trim();
      const requestedOrganizationName = normalizeOrganizationName(payload.organizationName);

      if (!requestedOrganizationId && !requestedOrganizationName) {
        return jsonResponse(400, { error: 'Organization id or name is required' });
      }

      try {
        const organization = requestedOrganizationId
          ? await getOrganizationById(adminClient, requestedOrganizationId)
          : await findOrganizationByName(adminClient, requestedOrganizationName);

        if (!organization?.id) {
          return jsonResponse(404, { error: 'Organization not found' });
        }

        targetOrganizationId = String(organization.id || '');
        targetOrganizationName = String(organization.name || requestedOrganizationName || '');
      } catch (error) {
        return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to load organization' });
      }
    } else {
      targetOrganizationId = String(callerProfile.organization_id || '');
      if (!targetOrganizationId) {
        return jsonResponse(400, { error: 'Your account is not linked to a business organization' });
      }

      try {
        const organization = await getOrganizationById(adminClient, targetOrganizationId);
        if (!organization?.id) {
          return jsonResponse(404, { error: 'Organization not found' });
        }
        targetOrganizationName = String(organization.name || '');
      } catch (error) {
        return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to load organization' });
      }
    }

    try {
      const needsFullSeed = await organizationWorkspaceNeedsSeed(adminClient, targetOrganizationId);
      if (needsFullSeed) {
        if (includeDemoData) {
          await seedOrganizationWorkspace(
            adminClient,
            targetOrganizationId,
            targetOrganizationName || 'Business Workspace',
            authData.user.id,
          );
        } else {
          await seedWorkspaceFoundationsOnly(
            adminClient,
            targetOrganizationId,
            targetOrganizationName || 'Business Workspace',
            authData.user.id,
          );
        }
      } else {
        await seedWorkspaceFoundationsIfMissing(
          adminClient,
          targetOrganizationId,
          targetOrganizationName || 'Business Workspace',
          authData.user.id,
        );
      }

      return jsonResponse(200, {
        success: true,
        organizationId: targetOrganizationId,
        organizationName: targetOrganizationName,
        mode: needsFullSeed ? (includeDemoData ? 'full-seed-with-demo' : 'clean-workspace') : 'foundation-repair',
        includeDemoData,
      });
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to prepare workspace' });
    }
  }

  if (action === 'seed-learning-data') {
    const requestedOrganizationId = String(payload.organizationId || '').trim();
    const targetOrganizationId = callerIsPlatformOwner
      ? requestedOrganizationId
      : String(callerProfile.organization_id || '').trim();
    const collection = String(payload.collection || '').trim();
    const records = Array.isArray(payload.records) ? payload.records as Array<Record<string, unknown>> : [];

    if (!targetOrganizationId || !collection) {
      return jsonResponse(400, { error: 'Organization id and collection are required' });
    }

    if (records.length === 0) {
      return jsonResponse(200, { success: true, collection, count: 0 });
    }

    const rows = records.map((record) => ({
      organization_id: targetOrganizationId,
      collection,
      record_id: String(record.id || crypto.randomUUID()),
      payload: record,
      created_by: authData.user.id,
      updated_by: authData.user.id,
    }));

    const { error } = await adminClient.from('app_records').upsert(rows, {
      onConflict: 'organization_id,collection,record_id',
    });

    if (error) {
      return jsonResponse(500, { error: error.message });
    }

    return jsonResponse(200, { success: true, collection, count: rows.length });
  }

  if (action === 'cleanup-user-references') {
    if (!callerIsPlatformOwner) {
      return jsonResponse(403, { error: 'Only platform owner can clean up user references' });
    }

    if (!id) {
      return jsonResponse(400, { error: 'Id is required' });
    }

    try {
      await clearUserAuditReferences(adminClient, id);
      const references = await countUserAuditReferences(adminClient, id);
      return jsonResponse(200, { success: true, id, references });
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to clean up user references' });
    }
  }

  if (action === 'clear-workspace-data') {
    if (!callerIsPlatformOwner) {
      return jsonResponse(403, { error: 'Only platform owner can clear workspace data' });
    }

    const organizationId = String(payload.organizationId || '').trim();
    const targetOrganizationName = normalizeOrganizationName(payload.organizationName);
    const preserveUsers = Boolean(payload.preserveUsers ?? true);

    if (!organizationId && !targetOrganizationName) {
      return jsonResponse(400, { error: 'Organization id or name is required' });
    }

    let organization = null;

    try {
      if (organizationId) {
        const { data, error } = await adminClient
          .from('organizations')
          .select('id, name')
          .eq('id', organizationId)
          .maybeSingle();

        if (error) throw error;
        organization = data;
      } else {
        organization = await findOrganizationByName(adminClient, targetOrganizationName);
      }
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to load organization' });
    }

    if (!organization?.id) {
      return jsonResponse(404, { error: 'Organization not found' });
    }

    try {
      // Delete all app_records except user-logins and user-rights
      const { data: collections, error: collectionsError } = await adminClient
        .from('app_records')
        .select('collection')
        .eq('organization_id', organization.id)
        .neq('collection', 'user-logins')
        .neq('collection', 'user-rights');

      if (collectionsError) throw collectionsError;

      const uniqueCollections = [...new Set((collections || []).map(r => r.collection))];
      let deletedCount = 0;

      for (const collection of uniqueCollections) {
        const { error: deleteError } = await adminClient
          .from('app_records')
          .delete()
          .eq('organization_id', organization.id)
          .eq('collection', collection);

        if (deleteError) throw deleteError;
        deletedCount++;
      }

      // Delete counters
      const { error: countersError } = await adminClient
        .from('app_counters')
        .delete()
        .eq('organization_id', organization.id);

      if (countersError) throw countersError;

      // Re-seed only foundations (clean workspace)
      await seedWorkspaceFoundationsOnly(
        adminClient,
        organization.id,
        organization.name || 'Business Workspace',
        authData.user.id,
      );

      return jsonResponse(200, {
        success: true,
        organizationId: organization.id,
        organizationName: organization.name,
        clearedCollections: deletedCount,
        mode: 'clean-workspace',
        message: 'Workspace data cleared. Essential settings restored.',
      });
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to clear workspace data' });
    }
  }

  if (action === 'delete-organization') {
    if (!callerIsPlatformOwner) {
      return jsonResponse(403, { error: 'Only platform owner can delete organizations' });
    }

    const organizationId = String(payload.organizationId || '').trim();
    const targetOrganizationName = normalizeOrganizationName(payload.organizationName);

    if (!organizationId && !targetOrganizationName) {
      return jsonResponse(400, { error: 'Organization id or name is required' });
    }

    let organization = null;

    try {
      if (organizationId) {
        const { data, error } = await adminClient
          .from('organizations')
          .select('id, name')
          .eq('id', organizationId)
          .maybeSingle();

        if (error) {
          throw error;
        }

        organization = data;
      } else {
        organization = await findOrganizationByName(adminClient, targetOrganizationName);
      }
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to load organization' });
    }

    if (!organization?.id) {
      return jsonResponse(404, { error: 'Organization not found' });
    }

    try {
      const linkedUsers = await countOrganizationUsers(adminClient, String(organization.id));
      if (linkedUsers > 0) {
        return jsonResponse(400, { error: 'Organization still has linked users', count: linkedUsers });
      }
    } catch (error) {
      return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unable to verify linked users' });
    }

    const { error } = await adminClient
      .from('organizations')
      .delete()
      .eq('id', organization.id);

    if (error) {
      return jsonResponse(400, { error: error.message });
    }

    return jsonResponse(200, { success: true, id: organization.id, name: organization.name });
  }

  return jsonResponse(400, { error: 'Unsupported action' });
});
