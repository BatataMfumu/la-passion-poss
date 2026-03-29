package com.posticket.app

import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.posticket.app.databinding.ActivityLoginBinding

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private lateinit var syncManager: SyncManager
    private lateinit var authManager: AuthManager
    private var users = emptyList<RemoteUser>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        syncManager = SyncManager(this)
        authManager = AuthManager(this)

        if (authManager.isLoggedIn()) {
            openMain()
            return
        }

        binding.loginBtn.setOnClickListener { attemptLogin() }
        loadUsers()
    }

    private fun loadUsers() {
        binding.loginStatusView.text = "Chargement des utilisateurs..."
        Thread {
            runCatching {
                syncManager.pullBootstrap(syncManager.getServerUrl()).users
            }.onSuccess { remoteUsers ->
                users = remoteUsers.ifEmpty {
                    listOf(
                        RemoteUser("u1", "Admin", "admin"),
                        RemoteUser("u2", "Serveur 1", "serveur"),
                        RemoteUser("u3", "Cuisine", "kitchen")
                    )
                }
                runOnUiThread {
                    val labels = users.map { "${it.name} (${it.role})" }
                    binding.userSpinner.adapter =
                        ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
                    binding.loginStatusView.text = "Entrez votre PIN pour acceder au POS."
                }
            }.onFailure { error ->
                users = listOf(
                    RemoteUser("u1", "Admin", "admin"),
                    RemoteUser("u2", "Serveur 1", "serveur"),
                    RemoteUser("u3", "Cuisine", "kitchen")
                )
                runOnUiThread {
                    val labels = users.map { "${it.name} (${it.role})" }
                    binding.userSpinner.adapter =
                        ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
                    binding.loginStatusView.text =
                        "Mode local. Utilisateurs de secours charges.\n${error.message}"
                }
            }
        }.start()
    }

    private fun attemptLogin() {
        if (users.isEmpty()) {
            Toast.makeText(this, "Aucun utilisateur charge.", Toast.LENGTH_SHORT).show()
            return
        }
        val selectedUser = users.getOrNull(binding.userSpinner.selectedItemPosition) ?: return
        val pin = binding.pinInput.text.toString().trim()
        if (pin.isBlank()) {
            binding.loginStatusView.text = "Entrez le PIN."
            return
        }

        binding.loginStatusView.text = "Connexion en cours..."
        Thread {
            runCatching {
                syncManager.login(syncManager.getServerUrl(), selectedUser.name, pin)
            }.onSuccess { user ->
                authManager.saveUser(user)
                runOnUiThread {
                    Toast.makeText(this, "Bienvenue ${user.name}", Toast.LENGTH_SHORT).show()
                    openMain()
                }
            }.onFailure { error ->
                runOnUiThread {
                    binding.loginStatusView.text = "Connexion refusee: ${error.message}"
                }
            }
        }.start()
    }

    private fun openMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
