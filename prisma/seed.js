const { randomBytes } = require("node:crypto");
const { createPrismaClient } = require("../src/lib/prisma-client.cjs");
const { resolveSeedDatabaseUrl } = require("../src/lib/demo-seed-policy.cjs");
const databaseUrl = resolveSeedDatabaseUrl();
const prisma = createPrismaClient(databaseUrl);

async function main() {
  const { hashCredential } = await import("../src/lib/auth-local.js");
  return prisma.$transaction(
    async (db) => {
      const models = [
        "table",
        "category",
        "menuItem",
        "order",
        "orderItem",
        "payment",
        "cashShift",
        "paymentAttempt",
        "restaurantConfig",
        "staffUser",
        "floorElement",
        "floorPlanSection",
        "serviceRequest",
      ];
      const counts = await Promise.all(models.map((name) => db[name].count()));
      if (counts.some((count) => count !== 0))
        throw new Error("Demo seed requires a completely empty test database.");
      console.log("Örnek veriler oluşturuluyor...");

      // 2. Restoran Ayarı
      await db.restaurantConfig.create({
        data: {
          restaurantName: "TEPSY Demo Restoranı",
          restaurantCode: "DEMO01",
          ownerName: "Demo Sahibi",
          authEnabled: true,
          qrOrderEnabled: true,
          accessPasswordHash: hashCredential("TepsyDemo123!"),
          tagline: "Lezzetin ve Kalitenin Buluşma Noktası",
          currency: "₺",
          defaultLanguage: "tr",
          isSetupCompleted: true,
        },
      });

      for (const [name, role] of [
        ["Garson", "WAITER"],
        ["Mutfak", "KITCHEN"],
        ["Kasa", "CASHIER"],
      ]) {
        await db.staffUser.create({ data: { name, role, pinHash: hashCredential("1234") } });
      }

      // 3. Masalar (2D Koordinatlı)
      const initialTables = [
        // İç Mekan
        {
          tableNumber: "İ-1",
          capacity: 4,
          section: "İç Mekan",
          posX: 15,
          posY: 18,
          shape: "ROUND",
        },
        {
          tableNumber: "İ-2",
          capacity: 2,
          section: "İç Mekan",
          posX: 40,
          posY: 18,
          shape: "ROUND",
        },
        {
          tableNumber: "İ-3",
          capacity: 4,
          section: "İç Mekan",
          posX: 65,
          posY: 18,
          shape: "SQUARE",
        },
        {
          tableNumber: "İ-4",
          capacity: 6,
          section: "İç Mekan",
          posX: 85,
          posY: 18,
          shape: "RECTANGLE",
          width: 130,
        },
        {
          tableNumber: "İ-5",
          capacity: 4,
          section: "İç Mekan",
          posX: 25,
          posY: 55,
          shape: "SQUARE",
        },
        {
          tableNumber: "İ-6",
          capacity: 4,
          section: "İç Mekan",
          posX: 60,
          posY: 55,
          shape: "SQUARE",
        },
        // Bahçe
        { tableNumber: "B-1", capacity: 4, section: "Bahçe", posX: 20, posY: 25, shape: "ROUND" },
        { tableNumber: "B-2", capacity: 4, section: "Bahçe", posX: 50, posY: 25, shape: "ROUND" },
        {
          tableNumber: "B-3",
          capacity: 6,
          section: "Bahçe",
          posX: 80,
          posY: 25,
          shape: "RECTANGLE",
          width: 130,
        },
        { tableNumber: "B-4", capacity: 4, section: "Bahçe", posX: 35, posY: 65, shape: "ROUND" },
        // Teras
        { tableNumber: "T-1", capacity: 2, section: "Teras", posX: 25, posY: 30, shape: "ROUND" },
        { tableNumber: "T-2", capacity: 4, section: "Teras", posX: 55, posY: 30, shape: "SQUARE" },
        { tableNumber: "T-3", capacity: 4, section: "Teras", posX: 82, posY: 30, shape: "SQUARE" },
      ];

      for (const t of initialTables) {
        await db.table.create({
          data: {
            tableNumber: t.tableNumber,
            capacity: t.capacity,
            section: t.section,
            status: "AVAILABLE",
            qrToken: randomBytes(24).toString("hex"),
            posX: t.posX,
            posY: t.posY,
            shape: t.shape,
            width: t.width || 85,
            height: 85,
          },
        });
      }

      // 4. Kategoriler ve Menü
      const categoriesData = [
        {
          name: "Sıcak Kahveler",
          icon: "Coffee",
          items: [
            { name: "Espresso", price: 65, description: "Geleneksel yoğun İtalyan espressosu" },
            {
              name: "Türk Kahvesi",
              price: 55,
              description: "Közde ağır ateşte pişirilmiş taze kahve",
            },
            { name: "Filtre Kahve", price: 75, description: "Taze çekilmiş %100 Arabica çekirdek" },
            { name: "Caffe Latte", price: 85, description: "Kremamsı süt köpüğü ve taze espresso" },
            {
              name: "Cappuccino",
              price: 85,
              description: "Eşit oranda espresso, süt ve yoğun köpük",
            },
          ],
        },
        {
          name: "Soğuk İçecekler",
          icon: "GlassWater",
          items: [
            { name: "Iced Latte", price: 95, description: "Buzlu süt ve taze çift shot espresso" },
            {
              name: "Ev Yapımı Limonata",
              price: 75,
              description: "Taze nane ve sıkma limon ferahlığı",
            },
            { name: "Cold Brew", price: 105, description: "18 saat soğuk demlenmiş özel kahve" },
          ],
        },
        {
          name: "Tatlılar & Fırın",
          icon: "Cake",
          items: [
            {
              name: "San Sebastian Cheesecake",
              price: 140,
              description: "Belçika çikolatası sosu ile",
            },
            {
              name: "Tiramisu",
              price: 120,
              description: "Özel mascarpone peynirli İtalyan klasiği",
            },
            {
              name: "Tereyağlı Kruvasan",
              price: 80,
              description: "Fransız usulü çıtır kat kat kruvasan",
            },
          ],
        },
        {
          name: "Yemekler & Atıştırmalık",
          icon: "Utensils",
          items: [
            {
              name: "Özel Burger",
              price: 240,
              description: "180gr dana köfte, cheddar, patates kızartması",
            },
            {
              name: "Tavuklu Sezar Salata",
              price: 180,
              description: "Izgara tavuk, kruton ve parmesan",
            },
            {
              name: "Club Sandwich",
              price: 160,
              description: "Kaşar, hindi füme, domates ve patates",
            },
          ],
        },
      ];

      for (let i = 0; i < categoriesData.length; i++) {
        const cat = categoriesData[i];
        const createdCat = await db.category.create({
          data: { name: cat.name, icon: cat.icon, sortOrder: i + 1 },
        });

        for (const item of cat.items) {
          await db.menuItem.create({
            data: {
              name: item.name,
              price: item.price,
              description: item.description,
              isAvailable: true,
              categoryId: createdCat.id,
            },
          });
        }
      }

      const tables = await db.table.findMany({ orderBy: { tableNumber: "asc" } });
      const items = await db.menuItem.findMany({
        include: { category: true },
        orderBy: { name: "asc" },
      });
      for (let index = 0; index < 2; index++) {
        const selected = items.slice(index * 2, index * 2 + 2);
        const ready = index === 0;
        await db.order.create({
          data: {
            tableId: tables[index].id,
            status: ready ? "DELIVERED" : "PENDING",
            totalPrice: selected.reduce((total, item) => total + Number(item.price), 0),
            notes: "Demo siparişi",
            items: {
              create: selected.map((item) => ({
                menuItemId: item.id,
                quantity: 1,
                unitPrice: item.price,
                menuItemName: item.name,
                menuItemCategoryName: item.category.name,
                status: ready ? "READY" : "PENDING",
              })),
            },
          },
        });
        await db.table.update({ where: { id: tables[index].id }, data: { status: "OCCUPIED" } });
      }
      await db.cashShift.create({
        data: {
          activeKey: "ACTIVE",
          status: "OPEN",
          openingCash: 500,
          openedById: "owner",
          openingNote: "Demo vardiyası",
        },
      });
      console.log("Örnek veriler hazır.");
    },
    { timeout: 15000 }
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
