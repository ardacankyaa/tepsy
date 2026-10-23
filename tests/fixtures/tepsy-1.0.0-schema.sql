-- SQLite schema of TEPSY 1.0.0 (f37095d:prisma/schema.prisma), generated with
-- prisma migrate diff --from-empty --to-schema. Used only by tests/test_migration.py.
-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tableNumber" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "section" TEXT NOT NULL DEFAULT 'İç Mekan',
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "posX" REAL NOT NULL DEFAULT 20,
    "posY" REAL NOT NULL DEFAULT 20,
    "shape" TEXT NOT NULL DEFAULT 'SQUARE',
    "width" INTEGER NOT NULL DEFAULT 96,
    "height" INTEGER NOT NULL DEFAULT 96,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "qrToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icon" TEXT DEFAULT 'Utensils',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "price" DECIMAL NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tableId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "idempotencyKey" TEXT,
    "requestFingerprint" TEXT,
    "totalPrice" DECIMAL NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL NOT NULL,
    "menuItemName" TEXT,
    "menuItemCategoryName" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "cashShiftId" TEXT,
    "amountPaid" DECIMAL NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "requestFingerprint" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activeKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openingCash" DECIMAL NOT NULL DEFAULT 0,
    "closingCash" DECIMAL,
    "expectedCash" DECIMAL,
    "cashDifference" DECIMAL,
    "cashPayments" DECIMAL NOT NULL DEFAULT 0,
    "cardPayments" DECIMAL NOT NULL DEFAULT 0,
    "otherPayments" DECIMAL NOT NULL DEFAULT 0,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "paymentsSnapshot" TEXT NOT NULL DEFAULT '[]',
    "openingNote" TEXT,
    "closingNote" TEXT,
    "openedById" TEXT,
    "closedById" TEXT,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "responseJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RestaurantConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'config',
    "restaurantName" TEXT NOT NULL DEFAULT 'Gurme Kafe & Restoran',
    "restaurantLogoUrl" TEXT,
    "ownerName" TEXT DEFAULT '',
    "restaurantCode" TEXT NOT NULL DEFAULT 'RESTO',
    "tagline" TEXT DEFAULT 'Lezzetin ve Kalitenin Buluştuğu Yer',
    "currency" TEXT NOT NULL DEFAULT '₺',
    "defaultLanguage" TEXT NOT NULL DEFAULT 'tr',
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "authEnabled" BOOLEAN NOT NULL DEFAULT false,
    "qrOrderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "accessPasswordHash" TEXT,
    "isSetupCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'WAITER',
    "pinHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FloorElement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "section" TEXT NOT NULL DEFAULT 'İç Mekan',
    "type" TEXT NOT NULL,
    "label" TEXT,
    "posX" REAL NOT NULL DEFAULT 20,
    "posY" REAL NOT NULL DEFAULT 20,
    "width" INTEGER NOT NULL DEFAULT 96,
    "height" INTEGER NOT NULL DEFAULT 48,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FloorPlanSection" (
    "section" TEXT NOT NULL PRIMARY KEY,
    "width" INTEGER NOT NULL DEFAULT 720,
    "height" INTEGER NOT NULL DEFAULT 450,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tableId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "ServiceRequest_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Table_tableNumber_key" ON "Table"("tableNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Table_qrToken_key" ON "Table"("qrToken");

-- CreateIndex
CREATE INDEX "Table_section_idx" ON "Table"("section");

-- CreateIndex
CREATE INDEX "Table_status_idx" ON "Table"("status");

-- CreateIndex
CREATE INDEX "Table_isArchived_idx" ON "Table"("isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "MenuItem_categoryId_idx" ON "MenuItem"("categoryId");

-- CreateIndex
CREATE INDEX "MenuItem_isAvailable_idx" ON "MenuItem"("isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_tableId_idx" ON "Order"("tableId");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_status_idx" ON "OrderItem"("status");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_cashShiftId_idx" ON "Payment"("cashShiftId");

-- CreateIndex
CREATE INDEX "Payment_paymentMethod_idx" ON "Payment"("paymentMethod");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_orderId_key" ON "Payment"("idempotencyKey", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CashShift_activeKey_key" ON "CashShift"("activeKey");

-- CreateIndex
CREATE INDEX "CashShift_status_openedAt_idx" ON "CashShift"("status", "openedAt");

-- CreateIndex
CREATE INDEX "CashShift_closedAt_idx" ON "CashShift"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key" ON "PaymentAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantConfig_restaurantCode_key" ON "RestaurantConfig"("restaurantCode");

-- CreateIndex
CREATE INDEX "StaffUser_role_idx" ON "StaffUser"("role");

-- CreateIndex
CREATE INDEX "StaffUser_isActive_idx" ON "StaffUser"("isActive");

-- CreateIndex
CREATE INDEX "FloorElement_section_idx" ON "FloorElement"("section");

-- CreateIndex
CREATE INDEX "FloorElement_type_idx" ON "FloorElement"("type");

-- CreateIndex
CREATE INDEX "ServiceRequest_tableId_type_createdAt_idx" ON "ServiceRequest"("tableId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceRequest_status_createdAt_idx" ON "ServiceRequest"("status", "createdAt");

