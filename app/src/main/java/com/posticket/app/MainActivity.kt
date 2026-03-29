package com.posticket.app

import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.posticket.app.databinding.ActivityMainBinding
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

class MainActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_AUTO_PRINT_SAMPLE = "autoPrintSample"
        private const val TAG = "POSTicket"
        private const val RECEIPT_WIDTH = 32
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var integratedPrinterManager: IntegratedPrinterManager
    private lateinit var syncManager: SyncManager
    private lateinit var localStoreManager: LocalStoreManager
    private lateinit var authManager: AuthManager

    private val cartItems = mutableListOf<CartItem>()
    private val soldQuantities = mutableMapOf<String, Int>()
    private val orderHistory = mutableListOf<OrderHistoryEntry>()
    private val pendingOrders = mutableListOf<JSONObject>()
    private var establishmentName = "La Passion"
    private var establishmentAddress = "L'avenue des aviation Q/ Gare-centrale C/ Gombe"
    private var currencyCode = "CDF"
    private var quickProducts = mutableListOf(
        CatalogProduct("Eau minerale", 500, ProductCategory.DRINK),
        CatalogProduct("Soda", 1000, ProductCategory.DRINK),
        CatalogProduct("Cafe", 1000, ProductCategory.DRINK),
        CatalogProduct("Sandwich", 2500, ProductCategory.FOOD),
        CatalogProduct("Jus", 1500, ProductCategory.DRINK),
        CatalogProduct("Pain", 300, ProductCategory.FOOD)
    )
    private val tables = mutableListOf(
        DiningTable("T1", TableStatus.FREE),
        DiningTable("T2", TableStatus.OCCUPIED),
        DiningTable("T3", TableStatus.RESERVED),
        DiningTable("T4", TableStatus.FREE),
        DiningTable("T5", TableStatus.FREE),
        DiningTable("T6", TableStatus.OCCUPIED)
    )

    private var selectedMode = ServiceMode.RESTAURANT
    private var selectedPayment = PaymentMethod.CASH
    private var selectedTableId = "T1"
    private var latestKitchenStatusText = "Aucune verification cuisine pour le moment."
    private var terraceHappyHourPercent = 10

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        integratedPrinterManager = IntegratedPrinterManager(this)
        syncManager = SyncManager(this)
        localStoreManager = LocalStoreManager(this)
        authManager = AuthManager(this)
        if (!intent.getBooleanExtra(EXTRA_AUTO_PRINT_SAMPLE, false) && !authManager.isLoggedIn()) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }
        restoreLocalState()
        configureUi()
        maybeAutoPrintSample()
    }

    override fun onResume() {
        super.onResume()
        restoreLocalState()
        refreshUi()
    }

    private fun configureUi() {
        binding.quantityInput.setText("1")
        binding.currentUserView.text = authManager.currentUserLabel()

        configureModes()
        configurePayments()
        configureKitchen()

        binding.openSyncPageBtn.setOnClickListener {
            startActivity(Intent(this, SyncActivity::class.java))
        }
        binding.clearCartBtn.setOnClickListener { clearCurrentOrder() }
        binding.printBtn.setOnClickListener { printCurrentInvoice() }

        refreshUi()
    }

    private fun configureKitchen() {
        binding.checkKitchenBtn.setOnClickListener {
            val serverUrl = currentServerUrl()
            if (serverUrl.isBlank()) {
                Toast.makeText(this, "Serveur cloud indisponible.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            binding.kitchenStatusView.text = "Verification cuisine en cours..."
            Thread {
                runCatching {
                    syncManager.getKitchenSummary(serverUrl, selectedTableId)
                }.onSuccess { summary ->
                    val status = when (summary.latestTableStatus.lowercase(Locale.getDefault())) {
                        "ready" -> "Commande de $selectedTableId prete."
                        "preparing" -> "Commande de $selectedTableId en preparation."
                        "pending" -> "Commande de $selectedTableId en attente cuisine."
                        "served" -> "Commande de $selectedTableId servie."
                        else -> "Aucune commande cuisine recente pour $selectedTableId."
                    }
                    latestKitchenStatusText =
                        "$status\nEn attente: ${summary.pendingCount} | En preparation: ${summary.preparingCount} | Pretes: ${summary.readyCount}"
                    runOnUiThread {
                        binding.kitchenStatusView.text = latestKitchenStatusText
                    }
                }.onFailure { error ->
                    runOnUiThread {
                        binding.kitchenStatusView.text = "Echec verification cuisine: ${error.message}"
                    }
                }
            }.start()
        }
    }

    private fun configureModes() {
        binding.modeRestaurantBtn.setOnClickListener {
            selectedMode = ServiceMode.RESTAURANT
            refreshUi()
        }
        binding.modeTerraceBtn.setOnClickListener {
            selectedMode = ServiceMode.TERRACE
            refreshUi()
        }
    }

    private fun configurePayments() {
        binding.paymentCashBtn.setOnClickListener {
            selectedPayment = PaymentMethod.CASH
            refreshUi()
        }
        binding.paymentMobileBtn.setOnClickListener {
            selectedPayment = PaymentMethod.MOBILE_MONEY
            refreshUi()
        }
        binding.paymentCardBtn.setOnClickListener {
            selectedPayment = PaymentMethod.CARD
            refreshUi()
        }
    }

    private fun addCatalogProduct(product: CatalogProduct) {
        val quantity = binding.quantityInput.text.toString().trim().toIntOrNull()?.takeIf { it > 0 } ?: 1
        cartItems += CartItem(product.name, product.unitPrice, quantity, product.category)
        binding.quantityInput.setText("1")
        markCurrentTableOccupied()
        refreshUi()
        Toast.makeText(this, "${product.name} ajoute.", Toast.LENGTH_SHORT).show()
    }

    private fun clearCurrentOrder() {
        cartItems.clear()
        binding.quantityInput.setText("1")
        binding.discountInput.setText("")
        if (selectedMode == ServiceMode.RESTAURANT) {
            updateSelectedTableStatus(TableStatus.FREE)
        }
        saveLocalState()
        refreshUi()
    }

    private fun printCurrentInvoice() {
        if (cartItems.isEmpty()) {
            Toast.makeText(this, "Ajoutez au moins un produit.", Toast.LENGTH_SHORT).show()
            return
        }

        val localOrderId = UUID.randomUUID().toString()
        val invoiceLines = buildInvoiceLines()
        val orderPayload = buildOrderPayload(localOrderId)
        val historyEntry = buildHistoryEntry(localOrderId, orderPayload)

        runCatching {
            integratedPrinterManager.printText(invoiceLines)
        }.onSuccess {
            Toast.makeText(this, "Impression envoyee.", Toast.LENGTH_SHORT).show()
            addHistoryEntry(historyEntry)
            pushOrderToServer(orderPayload)
            finalizeOrderAfterPrint()
        }.onFailure { error ->
            Log.e(TAG, "Manual print failed.", error)
            Toast.makeText(this, "Echec impression: ${error.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun pushOrderToServer(payload: JSONObject) {
        val serverUrl = currentServerUrl()
        if (serverUrl.isBlank()) {
            Toast.makeText(this, "Commande locale uniquement.", Toast.LENGTH_SHORT).show()
            return
        }

        Thread {
            runCatching {
                syncManager.pushOrder(serverUrl, payload)
            }.onSuccess {
                val localOrderId = payload.optString("localOrderId")
                runOnUiThread {
                    Toast.makeText(this, "Commande envoyee au PC admin.", Toast.LENGTH_SHORT).show()
                    markOrderAsSynced(localOrderId)
                }
            }.onFailure { error ->
                queuePendingOrder(payload)
                runOnUiThread {
                    Toast.makeText(this, "Imprimee hors ligne: ${error.message}", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun finalizeOrderAfterPrint() {
        registerSaleStats()
        if (selectedMode == ServiceMode.RESTAURANT) {
            updateSelectedTableStatus(TableStatus.FREE)
        }
        cartItems.clear()
        binding.discountInput.setText("")
        binding.quantityInput.setText("1")
        saveLocalState()
        refreshUi()
    }

    private fun refreshUi() {
        binding.modeSummaryView.text = when (selectedMode) {
            ServiceMode.RESTAURANT -> "Service restaurant actif. Ouvrez une table, prenez la commande, puis encaissez."
            ServiceMode.TERRACE -> "Service terrasse actif. Boissons rapides et happy hour automatique."
        }
        binding.happyHourView.text = if (selectedMode == ServiceMode.TERRACE) {
            "Happy hour terrasse: -${terraceHappyHourPercent}% sur les boissons."
        } else {
            "Mode restaurant: suivi par table et commande complete."
        }
        binding.tablesCard.visibility = if (selectedMode == ServiceMode.RESTAURANT) View.VISIBLE else View.GONE
        binding.kitchenCard.visibility = if (selectedMode == ServiceMode.RESTAURANT) View.VISIBLE else View.GONE
        binding.kitchenStatusView.text = latestKitchenStatusText

        renderQuickProductButtons()
        refreshTableSummary()
        refreshOrderSummary()
        refreshStats()
    }

    private fun refreshTableSummary() {
        if (tables.none { it.id == selectedTableId } && tables.isNotEmpty()) {
            selectedTableId = tables.first().id
        }
        val free = tables.count { it.status == TableStatus.FREE }
        val occupied = tables.count { it.status == TableStatus.OCCUPIED }
        val reserved = tables.count { it.status == TableStatus.RESERVED }
        binding.tableSummaryView.text = "Libres: $free   Occupees: $occupied   Reservees: $reserved"
        renderTableButtons()
    }

    private fun refreshOrderSummary() {
        binding.cartView.text = if (cartItems.isEmpty()) {
            "Panier vide."
        } else {
            cartItems.mapIndexed { index, item ->
                "${index + 1}. ${item.name}\n${item.quantity} x ${formatMoney(item.unitPrice)} = ${formatMoney(item.lineTotal)}"
            }.joinToString("\n\n")
        }

        val subtotal = cartItems.sumOf { it.lineTotal }
        val manualDiscount = currentDiscount().coerceAtMost(subtotal)
        val happyHourDiscount = terraceHappyHourDiscount()
        val total = (subtotal - manualDiscount - happyHourDiscount).coerceAtLeast(0)

        binding.totalsView.text = listOf(
            "Etablissement: $establishmentName",
            "Adresse: $establishmentAddress",
            "Service: ${selectedMode.label}",
            if (selectedMode == ServiceMode.RESTAURANT) "Table: $selectedTableId" else "Zone: Terrasse",
            "Paiement: ${selectedPayment.label}",
            "Sous-total: ${formatMoney(subtotal)}",
            "Remise manuelle: ${formatMoney(manualDiscount)}",
            "Happy hour: ${formatMoney(happyHourDiscount)}",
            "Total: ${formatMoney(total)}"
        ).joinToString("\n")

    }

    private fun refreshStats() {
        binding.statsView.text = if (soldQuantities.isEmpty()) {
            "Statistiques session\nAucune vente enregistree pour le moment."
        } else {
            val topSale = soldQuantities.maxByOrNull { it.value }
            listOf(
                "Statistiques session",
                topSale?.let { "Top vente: ${it.key} (${it.value})" } ?: "Top vente: -",
                "Articles vendus: ${soldQuantities.values.sum()}",
                "References actives: ${soldQuantities.size}"
            ).joinToString("\n")
        }
    }

    private fun buildInvoiceLines(): List<String> {
        val subtotal = cartItems.sumOf { it.lineTotal }
        val manualDiscount = currentDiscount().coerceAtMost(subtotal)
        val happyHourDiscount = terraceHappyHourDiscount()
        val total = (subtotal - manualDiscount - happyHourDiscount).coerceAtLeast(0)

        return mutableListOf<String>().apply {
            addAll(buildReceiptHeader())
            add(formatReceiptLine("Mode", selectedMode.label))
            add(
                formatReceiptLine(
                    if (selectedMode == ServiceMode.RESTAURANT) "Table" else "Zone",
                    if (selectedMode == ServiceMode.RESTAURANT) selectedTableId else "Terrasse"
                )
            )
            add(formatReceiptLine("Date", currentDateTime()))
            add(receiptDivider())
            cartItems.forEach { item ->
                addAll(formatReceiptItem(item))
            }
            add(receiptDivider())
            add(formatReceiptLine("Paiement", selectedPayment.label))
            add(formatReceiptLine("Sous-total", formatMoney(subtotal)))
            if (manualDiscount > 0) {
                add(formatReceiptLine("Remise", formatMoney(manualDiscount)))
            }
            if (happyHourDiscount > 0) {
                add(formatReceiptLine("Happy hour", formatMoney(happyHourDiscount)))
            }
            add(receiptDivider('='))
            add(formatReceiptLine("TOTAL", formatMoney(total)))
            add(receiptDivider('='))
            add(
                if (selectedMode == ServiceMode.RESTAURANT) {
                    centerReceiptText("Commande transmise cuisine")
                } else {
                    centerReceiptText("Service terrasse rapide")
                }
            )
            add(centerReceiptText("Merci pour votre visite"))
            add("")
            add("")
            add("")
        }
    }

    private fun buildOrderPayload(localOrderId: String): JSONObject {
        val subtotal = cartItems.sumOf { it.lineTotal }
        val manualDiscount = currentDiscount().coerceAtMost(subtotal)
        val happyHourDiscount = terraceHappyHourDiscount()
        val total = (subtotal - manualDiscount - happyHourDiscount).coerceAtLeast(0)

        val itemsArray = JSONArray()
        cartItems.forEach { item ->
            itemsArray.put(
                JSONObject(
                    mapOf(
                        "name" to item.name,
                        "price" to item.unitPrice,
                        "quantity" to item.quantity,
                        "category" to item.category.name.lowercase(Locale.getDefault()),
                        "lineTotal" to item.lineTotal
                    )
                )
            )
        }

        return JSONObject(
            mapOf(
                "localOrderId" to localOrderId,
                "source" to selectedMode.name.lowercase(Locale.getDefault()),
                "tableId" to if (selectedMode == ServiceMode.RESTAURANT) selectedTableId else JSONObject.NULL,
                "paymentMethod" to selectedPayment.label,
                "subtotal" to subtotal,
                "manualDiscount" to manualDiscount,
                "happyHourDiscount" to happyHourDiscount,
                "total" to total,
                "printedAt" to currentDateTime(),
                "items" to itemsArray
            )
        )
    }

    private fun buildHistoryEntry(localOrderId: String, payload: JSONObject): OrderHistoryEntry {
        val label = if (payload.optString("source") == "restaurant") {
            "Restaurant ${payload.optString("tableId", "")}"
        } else {
            "Terrasse"
        }
        return OrderHistoryEntry(
            localOrderId = localOrderId,
            timestamp = payload.optString("printedAt", currentDateTime()),
            label = label.trim(),
            amount = formatMoney(payload.optLong("total", 0)),
            syncStatus = "En attente sync"
        )
    }

    private fun addHistoryEntry(entry: OrderHistoryEntry) {
        orderHistory.add(0, entry)
        saveLocalState()
    }

    private fun markOrderAsSynced(localOrderId: String) {
        orderHistory.find { it.localOrderId == localOrderId }?.syncStatus = "Synchronisee"
        pendingOrders.removeAll { it.optString("localOrderId") == localOrderId }
        saveLocalState()
        runOnUiThread {
            refreshUi()
        }
    }

    private fun queuePendingOrder(payload: JSONObject) {
        val localOrderId = payload.optString("localOrderId")
        if (pendingOrders.none { it.optString("localOrderId") == localOrderId }) {
            pendingOrders += payload
        }
        orderHistory.find { it.localOrderId == localOrderId }?.syncStatus = "Hors ligne"
        saveLocalState()
        runOnUiThread {
            refreshUi()
        }
    }

    private fun flushPendingOrders() {
        val serverUrl = currentServerUrl()
        if (serverUrl.isBlank()) {
            Toast.makeText(this, "Aucun serveur cloud disponible.", Toast.LENGTH_SHORT).show()
            return
        }
        if (pendingOrders.isEmpty()) {
            Toast.makeText(this, "Aucune vente en attente.", Toast.LENGTH_SHORT).show()
            return
        }
        val snapshot = pendingOrders.toList()
        Thread {
            var successCount = 0
            snapshot.forEach { payload ->
                runCatching {
                    syncManager.pushOrder(serverUrl, payload)
                }.onSuccess {
                    successCount += 1
                    markOrderAsSynced(payload.optString("localOrderId"))
                }
            }
            runOnUiThread {
                Toast.makeText(
                    this,
                    "Ventes synchronisees: $successCount / ${snapshot.size}",
                    Toast.LENGTH_LONG
                ).show()
                refreshUi()
            }
        }.start()
    }

    private fun restoreLocalState() {
        localStoreManager.loadCatalog()?.let { catalog ->
            establishmentName = catalog.optString("establishmentName", establishmentName)
            establishmentAddress = catalog.optString("establishmentAddress", establishmentAddress)
            currencyCode = catalog.optString("currency", currencyCode)
            terraceHappyHourPercent = catalog.optInt("terraceHappyHourPercent", terraceHappyHourPercent)
            val products = catalog.optJSONArray("products") ?: JSONArray()
            if (products.length() > 0) {
                quickProducts.clear()
                repeat(products.length()) { index ->
                    val item = products.optJSONObject(index) ?: JSONObject()
                    quickProducts += CatalogProduct(
                        name = item.optString("name", "Produit"),
                        unitPrice = item.optLong("unitPrice", 0),
                        category = productCategoryFromServer(item.optString("category", "mixed"))
                    )
                }
            }
            val savedTables = catalog.optJSONArray("tables") ?: JSONArray()
            if (savedTables.length() > 0) {
                tables.clear()
                repeat(savedTables.length()) { index ->
                    val item = savedTables.optJSONObject(index) ?: JSONObject()
                    tables += DiningTable(
                        id = item.optString("id", "T${index + 1}"),
                        status = tableStatusFromServer(item.optString("status", "free"))
                    )
                }
            }
        }

        localStoreManager.loadStats()?.let { stats ->
            val statsObject = stats.optJSONObject("soldQuantities") ?: JSONObject()
            soldQuantities.clear()
            statsObject.keys().forEach { key ->
                soldQuantities[key] = statsObject.optInt(key, 0)
            }
        }

        val historyArray = localStoreManager.loadHistory()
        orderHistory.clear()
        repeat(historyArray.length()) { index ->
            val item = historyArray.optJSONObject(index) ?: JSONObject()
            orderHistory += OrderHistoryEntry(
                localOrderId = item.optString("localOrderId"),
                timestamp = item.optString("timestamp"),
                label = item.optString("label"),
                amount = item.optString("amount"),
                syncStatus = item.optString("syncStatus")
            )
        }

        val pendingArray = localStoreManager.loadPendingOrders()
        pendingOrders.clear()
        repeat(pendingArray.length()) { index ->
            pendingOrders += (pendingArray.optJSONObject(index) ?: JSONObject())
        }
    }

    private fun saveLocalState() {
        localStoreManager.saveCatalog(buildCatalogSnapshot())
        localStoreManager.saveStats(buildStatsSnapshot())
        localStoreManager.saveHistory(buildHistorySnapshot())
        localStoreManager.savePendingOrders(buildPendingSnapshot())
    }

    private fun buildCatalogSnapshot(): JSONObject {
        val products = JSONArray()
        quickProducts.forEach {
            products.put(
                JSONObject(
                    mapOf(
                        "name" to it.name,
                        "unitPrice" to it.unitPrice,
                        "category" to it.category.name.lowercase(Locale.getDefault())
                    )
                )
            )
        }

        val tablesArray = JSONArray()
        tables.forEach {
            tablesArray.put(
                JSONObject(
                    mapOf(
                        "id" to it.id,
                        "status" to it.status.name.lowercase(Locale.getDefault())
                    )
                )
            )
        }

        return JSONObject(
            mapOf(
                "establishmentName" to establishmentName,
                "establishmentAddress" to establishmentAddress,
                "currency" to currencyCode,
                "terraceHappyHourPercent" to terraceHappyHourPercent,
                "products" to products,
                "tables" to tablesArray
            )
        )
    }

    private fun buildStatsSnapshot(): JSONObject {
        val stats = JSONObject()
        soldQuantities.forEach { (key, value) ->
            stats.put(key, value)
        }
        return JSONObject(mapOf("soldQuantities" to stats))
    }

    private fun buildHistorySnapshot(): JSONArray {
        val array = JSONArray()
        orderHistory.forEach {
            array.put(
                JSONObject(
                    mapOf(
                        "localOrderId" to it.localOrderId,
                        "timestamp" to it.timestamp,
                        "label" to it.label,
                        "amount" to it.amount,
                        "syncStatus" to it.syncStatus
                    )
                )
            )
        }
        return array
    }

    private fun buildPendingSnapshot(): JSONArray {
        val array = JSONArray()
        pendingOrders.forEach { array.put(it) }
        return array
    }

    private fun terraceHappyHourDiscount(): Long {
        if (selectedMode != ServiceMode.TERRACE) return 0L
        val drinksTotal = cartItems.filter { it.category == ProductCategory.DRINK }.sumOf { it.lineTotal }
        return (drinksTotal * terraceHappyHourPercent.toLong()) / 100L
    }

    private fun currentDiscount(): Long {
        return binding.discountInput.text.toString().trim().toLongOrNull()?.coerceAtLeast(0L) ?: 0L
    }

    private fun formatMoney(value: Long): String {
        val reversed = value.toString().reversed().chunked(3).joinToString(" ").reversed()
        return "$reversed $currencyCode"
    }

    private fun currentDateTime(): String {
        return SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.FRANCE).format(Date())
    }

    private fun selectTable(tableId: String) {
        selectedTableId = tableId
        refreshUi()
    }

    private fun renderQuickProductButtons() {
        renderButtonGrid(
            container = binding.productsGridLayout,
            items = quickProducts.map { product ->
                product.buttonLabel() to { addCatalogProduct(product) }
            }
        )
    }

    private fun renderTableButtons() {
        renderButtonGrid(
            container = binding.tablesGridLayout,
            items = tables.map { table ->
                val selectedMarker = if (table.id == selectedTableId) " *" else ""
                "${table.id}\n${table.status.label}$selectedMarker" to { selectTable(table.id) }
            }
        )
    }

    private fun renderButtonGrid(
        container: LinearLayout,
        items: List<Pair<String, () -> Unit>>
    ) {
        container.removeAllViews()
        items.chunked(2).forEachIndexed { rowIndex, chunk ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    topMargin = if (rowIndex == 0) 0 else dp(10)
                }
            }

            chunk.forEachIndexed { index, (label, action) ->
                val button = Button(this).apply {
                    text = label
                    setOnClickListener { action() }
                    layoutParams = LinearLayout.LayoutParams(
                        0,
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        1f
                    ).apply {
                        marginEnd = if (index == 0 && chunk.size > 1) dp(6) else 0
                        marginStart = if (index == 1) dp(6) else 0
                    }
                }
                row.addView(button)
            }

            if (chunk.size == 1) {
                row.addView(View(this).apply {
                    layoutParams = LinearLayout.LayoutParams(
                        0,
                        0,
                        1f
                    )
                })
            }
            container.addView(row)
        }
    }

    private fun currentServerUrl(): String = syncManager.getServerUrl().trim().trimEnd('/')

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun markCurrentTableOccupied() {
        if (selectedMode == ServiceMode.RESTAURANT) {
            updateSelectedTableStatus(TableStatus.OCCUPIED)
        }
    }

    private fun updateSelectedTableStatus(status: TableStatus) {
        tables.find { it.id == selectedTableId }?.status = status
    }

    private fun registerSaleStats() {
        cartItems.forEach { item ->
            soldQuantities[item.name] = soldQuantities.getOrDefault(item.name, 0) + item.quantity
        }
    }

    private fun productCategoryFromServer(category: String): ProductCategory {
        return when (category.lowercase(Locale.getDefault())) {
            "food", "dish" -> ProductCategory.FOOD
            "drink", "beverage" -> ProductCategory.DRINK
            else -> ProductCategory.MIXED
        }
    }

    private fun tableStatusFromServer(status: String): TableStatus {
        return when (status.lowercase(Locale.getDefault())) {
            "occupied" -> TableStatus.OCCUPIED
            "reserved" -> TableStatus.RESERVED
            else -> TableStatus.FREE
        }
    }

    private fun maybeAutoPrintSample() {
        if (!intent.getBooleanExtra(EXTRA_AUTO_PRINT_SAMPLE, false)) {
            return
        }

        Thread {
            runCatching {
                writeDebugStatus("attempt")
                val lines = mutableListOf<String>().apply {
                    addAll(buildReceiptHeader("FACTURE EXEMPLE"))
                    add(formatReceiptLine("Mode", "Restaurant"))
                    add(formatReceiptLine("Table", "T2"))
                    add(formatReceiptLine("Date", currentDateTime()))
                    add(receiptDivider())
                    add("Eau minerale")
                    add(formatReceiptLine("2 x 500 CDF", "1 000 CDF"))
                    add("Sandwich")
                    add(formatReceiptLine("1 x 2 500 CDF", "2 500 CDF"))
                    add("Cafe")
                    add(formatReceiptLine("2 x 1 000 CDF", "2 000 CDF"))
                    add(receiptDivider())
                    add(formatReceiptLine("Paiement", "Mobile Money"))
                    add(formatReceiptLine("Sous-total", "5 500 CDF"))
                    add(formatReceiptLine("Remise", "500 CDF"))
                    add(receiptDivider('='))
                    add(formatReceiptLine("TOTAL", "5 000 CDF"))
                    add(receiptDivider('='))
                    add(centerReceiptText("Commande transmise cuisine"))
                    add(centerReceiptText("Merci pour votre visite"))
                    add("")
                    add("")
                    add("")
                }
                integratedPrinterManager.printText(lines)
            }.onSuccess {
                writeDebugStatus("success")
                Log.i(TAG, "Integrated sample print sent successfully.")
                runOnUiThread {
                    Toast.makeText(this, "Test impression envoye.", Toast.LENGTH_LONG).show()
                }
            }.onFailure { error ->
                writeDebugStatus("failure:${error::class.java.simpleName}:${error.message}")
                Log.e(TAG, "Integrated sample print failed.", error)
                runOnUiThread {
                    Toast.makeText(this, "Echec impression: ${error.message}", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun writeDebugStatus(value: String) {
        runCatching {
            File(filesDir, "print-test-status.txt").writeText(value)
        }
    }

    private fun buildReceiptHeader(title: String = "FACTURE CLIENT"): List<String> {
        return mutableListOf<String>().apply {
            add(centerReceiptText(establishmentName.uppercase(Locale.getDefault())))
            wrapReceiptText(establishmentAddress.uppercase(Locale.getDefault())).forEach { line ->
                add(centerReceiptText(line))
            }
            add(receiptDivider())
            add(centerReceiptText(title))
            add(receiptDivider())
        }
    }

    private fun formatReceiptItem(item: CartItem): List<String> {
        val quantityAndPrice = "${item.quantity} x ${formatMoney(item.unitPrice)}"
        return mutableListOf<String>().apply {
            wrapReceiptText(item.name).forEach { line ->
                add(line)
            }
            add(formatReceiptLine(quantityAndPrice, formatMoney(item.lineTotal)))
        }
    }

    private fun formatReceiptLine(left: String, right: String): String {
        val cleanLeft = left.trim()
        val cleanRight = right.trim()
        val available = RECEIPT_WIDTH - cleanRight.length - 1
        if (available <= 0) {
            return truncateReceiptText(cleanLeft, RECEIPT_WIDTH)
        }
        if (cleanLeft.length > available) {
            return truncateReceiptText(cleanLeft, available) + " " + cleanRight
        }
        return cleanLeft.padEnd(available) + " " + cleanRight
    }

    private fun centerReceiptText(value: String): String {
        val clean = truncateReceiptText(value.trim(), RECEIPT_WIDTH)
        if (clean.length >= RECEIPT_WIDTH) {
            return clean
        }
        val leftPadding = (RECEIPT_WIDTH - clean.length) / 2
        return " ".repeat(leftPadding) + clean
    }

    private fun wrapReceiptText(value: String): List<String> {
        val words = value.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
        if (words.isEmpty()) {
            return listOf("")
        }

        val lines = mutableListOf<String>()
        var current = ""
        words.forEach { word ->
            val next = if (current.isBlank()) word else "$current $word"
            if (next.length <= RECEIPT_WIDTH) {
                current = next
            } else {
                if (current.isNotBlank()) {
                    lines += current
                }
                current = if (word.length <= RECEIPT_WIDTH) word else truncateReceiptText(word, RECEIPT_WIDTH)
            }
        }
        if (current.isNotBlank()) {
            lines += current
        }
        return lines
    }

    private fun truncateReceiptText(value: String, maxLength: Int): String {
        return if (value.length <= maxLength) value else value.take(maxLength)
    }

    private fun receiptDivider(char: Char = '-'): String = char.toString().repeat(RECEIPT_WIDTH)

    private data class CartItem(
        val name: String,
        val unitPrice: Long,
        val quantity: Int,
        val category: ProductCategory
    ) {
        val lineTotal: Long
            get() = unitPrice * quantity
    }

    private data class CatalogProduct(
        val name: String,
        val unitPrice: Long,
        val category: ProductCategory
    ) {
        fun buttonLabel(): String = "$name\n$unitPrice CDF"
    }

    private data class DiningTable(
        val id: String,
        var status: TableStatus
    )

    private data class OrderHistoryEntry(
        val localOrderId: String,
        val timestamp: String,
        val label: String,
        val amount: String,
        var syncStatus: String
    )

    private enum class ServiceMode(val label: String) {
        RESTAURANT("Restaurant"),
        TERRACE("Terrasse")
    }

    private enum class PaymentMethod(val label: String) {
        CASH("Cash"),
        MOBILE_MONEY("Mobile Money"),
        CARD("Carte")
    }

    private enum class ProductCategory {
        FOOD,
        DRINK,
        MIXED
    }

    private enum class TableStatus(val label: String) {
        FREE("Libre"),
        OCCUPIED("Occupee"),
        RESERVED("Reservee")
    }
}
