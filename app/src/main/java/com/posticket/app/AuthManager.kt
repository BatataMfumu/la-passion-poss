package com.posticket.app

import android.content.Context

class AuthManager(context: Context) {

    companion object {
        private const val PREFS = "la_passion_auth"
        private const val KEY_NAME = "user_name"
        private const val KEY_ROLE = "user_role"
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isLoggedIn(): Boolean = prefs.contains(KEY_NAME)

    fun saveUser(user: RemoteUser) {
        prefs.edit()
            .putString(KEY_NAME, user.name)
            .putString(KEY_ROLE, user.role)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun currentUserLabel(): String {
        val name = prefs.getString(KEY_NAME, null) ?: return "Utilisateur non connecte"
        val role = prefs.getString(KEY_ROLE, "serveur").orEmpty()
        return "$name (${role.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }})"
    }
}
