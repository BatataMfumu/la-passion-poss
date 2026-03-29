package com.posticket.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class SyncManager(context: Context) {

    companion object {
        private const val PREFS = "la_passion_sync"
        private const val KEY_SERVER_URL = "server_url"
        private const val DEFAULT_SERVER_URL = "https://la-passion-pos.vercel.app"
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun getServerUrl(): String {
        val saved = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL)?.trim().orEmpty()
        return when {
            saved.isBlank() -> DEFAULT_SERVER_URL
            saved == "http://127.0.0.1:4100" -> DEFAULT_SERVER_URL
            saved == "http://localhost:4100" -> DEFAULT_SERVER_URL
            else -> saved
        }
    }

    fun saveServerUrl(url: String) {
        prefs.edit().putString(KEY_SERVER_URL, url).apply()
    }

    fun pullBootstrap(serverUrl: String): BootstrapPayload {
        val response = request("GET", "$serverUrl/api/bootstrap")
        val json = JSONObject(response)
        return BootstrapPayload(
            establishmentName = json.optJSONObject("settings")?.optString("establishmentName", "La Passion")
                ?: "La Passion",
            establishmentAddress = json.optJSONObject("settings")
                ?.optString("address", "L'avenue des aviation Q/ Gare-centrale C/ Gombe")
                ?: "L'avenue des aviation Q/ Gare-centrale C/ Gombe",
            currency = json.optJSONObject("settings")?.optString("currency", "CDF") ?: "CDF",
            terraceHappyHourPercent = json.optJSONObject("settings")
                ?.optInt("terraceHappyHourPercent", 10)
                ?: 10,
            products = json.optJSONArray("products").toProducts(),
            tables = json.optJSONArray("tables").toTables(),
            users = json.optJSONArray("users").toUsers()
        )
    }

    fun login(serverUrl: String, name: String, pin: String): RemoteUser {
        val response = request(
            "POST",
            "$serverUrl/api/login",
            JSONObject(mapOf("name" to name, "pin" to pin)).toString()
        )
        val json = JSONObject(response).optJSONObject("user") ?: JSONObject()
        return RemoteUser(
            id = json.optString("id"),
            name = json.optString("name"),
            role = json.optString("role")
        )
    }

    fun pushOrder(serverUrl: String, payload: JSONObject) {
        request("POST", "$serverUrl/api/orders", payload.toString())
    }

    fun getKitchenSummary(serverUrl: String, tableId: String): KitchenSummary {
        val response = request("GET", "$serverUrl/api/kitchen-summary?tableId=$tableId")
        val json = JSONObject(response)
        return KitchenSummary(
            pendingCount = json.optInt("pendingCount", 0),
            preparingCount = json.optInt("preparingCount", 0),
            readyCount = json.optInt("readyCount", 0),
            latestTableStatus = json.optString("latestTableStatus", ""),
            latestTableOrderId = json.optString("latestTableOrderId", "")
        )
    }

    private fun request(method: String, url: String, body: String? = null): String {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 8000
        connection.readTimeout = 8000
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Accept", "application/json")

        if (body != null) {
            connection.doOutput = true
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(body)
            }
        }

        val statusCode = connection.responseCode
        val stream = if (statusCode in 200..299) connection.inputStream else connection.errorStream
        val text = stream.bufferedReader().use(BufferedReader::readText)

        if (statusCode !in 200..299) {
            throw IllegalStateException("Erreur serveur ($statusCode): $text")
        }

        return text
    }

    private fun JSONArray?.toProducts(): List<RemoteProduct> {
        if (this == null) return emptyList()
        return List(length()) { index ->
            val item = optJSONObject(index) ?: JSONObject()
            RemoteProduct(
                id = item.optString("id"),
                name = item.optString("name", "Produit"),
                price = item.optLong("price", 0),
                category = item.optString("category", "mixed"),
                active = item.optBoolean("active", true)
            )
        }
    }

    private fun JSONArray?.toTables(): List<RemoteTable> {
        if (this == null) return emptyList()
        return List(length()) { index ->
            val item = optJSONObject(index) ?: JSONObject()
            RemoteTable(
                id = item.optString("id", "T?"),
                status = item.optString("status", "free")
            )
        }
    }

    private fun JSONArray?.toUsers(): List<RemoteUser> {
        if (this == null) return emptyList()
        return List(length()) { index ->
            val item = optJSONObject(index) ?: JSONObject()
            RemoteUser(
                id = item.optString("id"),
                name = item.optString("name"),
                role = item.optString("role")
            )
        }
    }
}

data class BootstrapPayload(
    val establishmentName: String,
    val establishmentAddress: String,
    val currency: String,
    val terraceHappyHourPercent: Int,
    val products: List<RemoteProduct>,
    val tables: List<RemoteTable>,
    val users: List<RemoteUser>
)

data class RemoteProduct(
    val id: String,
    val name: String,
    val price: Long,
    val category: String,
    val active: Boolean
)

data class RemoteTable(
    val id: String,
    val status: String
)

data class RemoteUser(
    val id: String,
    val name: String,
    val role: String
)

data class KitchenSummary(
    val pendingCount: Int,
    val preparingCount: Int,
    val readyCount: Int,
    val latestTableStatus: String,
    val latestTableOrderId: String
)
