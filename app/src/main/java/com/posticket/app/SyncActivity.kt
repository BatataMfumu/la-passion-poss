package com.posticket.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.posticket.app.databinding.ActivitySyncBinding
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

class SyncActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySyncBinding
    private lateinit var syncManager: SyncManager
    private lateinit var localStoreManager: LocalStoreManager
    private lateinit var authManager: AuthManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySyncBinding.inflate(layoutInflater)
        setContentView(binding.root)

        syncManager = SyncManager(this)
        localStoreManager = LocalStoreManager(this)
        authManager = AuthManager(this)

        binding.backToPosBtn.setOnClickListener { finish() }
        binding.syncCatalogBtn.setOnClickListener { syncCatalog() }
        binding.syncPendingBtn.setOnClickListener { flushPendingOrders() }
        binding.logoutBtn.setOnClickListener {
            authManager.clear()
            startActivity(Intent(this, LoginActivity::class.java))
            finishAffinity()
        }

        renderState("Pret pour la synchronisation cloud.")
    }

    private fun renderState(message: String) {
        val catalog = localStoreManager.loadCatalog()
        val productsCount = catalog?.optJSONArray("products")?.length() ?: 0
        val tablesCount = catalog?.optJSONArray("tables")?.length() ?: 0
        val pendingCount = localStoreManager.loadPendingOrders().length()
        val currency = catalog?.optString("currency", "CDF") ?: "CDF"

        binding.cloudInfoView.text = listOf(
            "Cloud La Passion actif",
            "Serveur configure et centralise sur Vercel",
            "Catalogue dynamique, tables et ventes relies a la base",
            "Devise active: $currency"
        ).joinToString("\n")
        binding.currentUserView.text = authManager.currentUserLabel()

        binding.localSummaryView.text = listOf(
            "Produits locaux: $productsCount",
            "Tables locales: $tablesCount",
            "Ventes en attente: $pendingCount"
        ).joinToString("\n")

        binding.syncStatusView.text = message
    }

    private fun syncCatalog() {
        val serverUrl = syncManager.getServerUrl()
        binding.syncStatusView.text = "Synchronisation du catalogue en cours..."
        Thread {
            runCatching {
                syncManager.pullBootstrap(serverUrl)
            }.onSuccess { bootstrap ->
                localStoreManager.saveCatalog(buildCatalogSnapshot(bootstrap))
                runOnUiThread {
                    setResult(Activity.RESULT_OK)
                    renderState(
                        "Catalogue mis a jour.\n" +
                            "${bootstrap.products.count { it.active }} produits actifs et ${bootstrap.tables.size} tables charges."
                    )
                    Toast.makeText(this, "Catalogue synchronise.", Toast.LENGTH_SHORT).show()
                }
            }.onFailure { error ->
                runOnUiThread {
                    renderState("Echec synchronisation: ${error.message}")
                    Toast.makeText(this, "Echec sync: ${error.message}", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun flushPendingOrders() {
        val pendingOrders = localStoreManager.loadPendingOrders()
        if (pendingOrders.length() == 0) {
            renderState("Aucune vente en attente.")
            return
        }

        binding.syncStatusView.text = "Envoi des ventes en attente..."
        Thread {
            var successCount = 0
            val remaining = JSONArray()
            val history = localStoreManager.loadHistory()

            repeat(pendingOrders.length()) { index ->
                val payload = pendingOrders.optJSONObject(index) ?: JSONObject()
                runCatching {
                    syncManager.pushOrder(syncManager.getServerUrl(), payload)
                }.onSuccess {
                    successCount += 1
                    markHistoryAsSynced(history, payload.optString("localOrderId"))
                }.onFailure {
                    remaining.put(payload)
                }
            }

            localStoreManager.savePendingOrders(remaining)
            localStoreManager.saveHistory(history)

            runOnUiThread {
                setResult(Activity.RESULT_OK)
                renderState("Ventes synchronisees: $successCount / ${pendingOrders.length()}")
                Toast.makeText(this, "Ventes envoyees: $successCount", Toast.LENGTH_SHORT).show()
            }
        }.start()
    }

    private fun buildCatalogSnapshot(bootstrap: BootstrapPayload): JSONObject {
        val products = JSONArray()
        bootstrap.products
            .filter { it.active }
            .forEach {
                products.put(
                    JSONObject(
                        mapOf(
                            "name" to it.name,
                            "unitPrice" to it.price,
                            "category" to it.category.lowercase(Locale.getDefault())
                        )
                    )
                )
            }

        val tables = JSONArray()
        bootstrap.tables.forEach {
            tables.put(
                JSONObject(
                    mapOf(
                        "id" to it.id,
                        "status" to it.status.lowercase(Locale.getDefault())
                    )
                )
            )
        }

        return JSONObject(
            mapOf(
                "establishmentName" to bootstrap.establishmentName,
                "establishmentAddress" to bootstrap.establishmentAddress,
                "currency" to bootstrap.currency,
                "terraceHappyHourPercent" to bootstrap.terraceHappyHourPercent,
                "products" to products,
                "tables" to tables
            )
        )
    }

    private fun markHistoryAsSynced(history: JSONArray, localOrderId: String) {
        repeat(history.length()) { index ->
            val item = history.optJSONObject(index) ?: return@repeat
            if (item.optString("localOrderId") == localOrderId) {
                item.put("syncStatus", "Synchronisee")
            }
        }
    }
}
