package academy.stint.notes

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.EventNote
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            StintTheme { Box(Modifier.fillMaxSize().background(T.bg)) { App() } }
        }
    }
}

private suspend fun <T> io(block: () -> T): Result<T> = withContext(Dispatchers.IO) { runCatching(block) }

@Composable
private fun App() {
    val ctx = LocalContext.current
    val api = remember { Api(ctx) }
    var signedIn by remember { mutableStateOf(api.store.signedIn) }
    var open by remember { mutableStateOf<String?>(null) }

    AnimatedContent(
        targetState = when { !signedIn -> "login"; open != null -> "note"; else -> "home" },
        transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) }, label = "screen",
    ) { screen ->
        when (screen) {
            "login" -> LoginScreen(api) { signedIn = true; UploadWorker.resendWaiting(ctx) }
            "note" -> NoteScreen(api, open ?: "") { open = null }
            else -> HomeScreen(api, onOpen = { open = it }, onSignOut = { api.store.signOut(); signedIn = false })
        }
    }
}

// ───────────────────────── shared pieces ─────────────────────────

/** Card in the CRM style: white surface, 1px line, 16px corners. */
@Composable
private fun Card(modifier: Modifier = Modifier, padding: Dp = 16.dp, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) 0.98f else 1f, spring(stiffness = 600f), label = "press")
    Column(
        modifier.fillMaxWidth().scale(s).clip(shape).background(T.surface).border(1.dp, T.line, shape)
            .then(if (onClick != null) Modifier.clickable(src, ripple(), onClick = onClick) else Modifier)
            .padding(padding),
        content = content,
    )
}

@Composable
private fun Pill(text: String, bg: Color, fg: Color, icon: ImageVector? = null) {
    Row(
        Modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) { Icon(icon, null, tint = fg, modifier = Modifier.size(13.dp)); Spacer(Modifier.width(4.dp)) }
        Text(text, color = fg, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun StatusPill(status: String) = when (status) {
    "Confirmed", "Done" -> Pill(status, T.goodBg, T.goodText, Icons.Default.Check)
    "Waiting to confirm" -> Pill("To confirm", T.warnBg, T.warnText)
    "Unmatched" -> Pill("Not linked", T.surface2, T.muted)
    "Transcribing" -> Pill("Writing…", T.accentSoft, T.accentText)
    else -> Pill(status.ifBlank { "Saved" }, T.accentSoft, T.accentText)
}

@Composable
private fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, color: Color = T.accent, icon: ImageVector? = null) {
    Button(
        onClick = onClick, enabled = enabled, shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Color.White, disabledContainerColor = T.surface2, disabledContentColor = T.muted),
        modifier = modifier.fillMaxWidth().height(52.dp),
    ) {
        if (icon != null) { Icon(icon, null, Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: String, type: KeyboardType = KeyboardType.Text, placeholder: String? = null, password: Boolean = false) {
    var show by remember { mutableStateOf(false) }
    Column {
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = T.text2)
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value, onChange, singleLine = true, shape = RoundedCornerShape(12.dp),
            placeholder = placeholder?.let { { Text(it, color = T.muted) } },
            visualTransformation = if (password && !show) PasswordVisualTransformation() else VisualTransformation.None,
            trailingIcon = if (password) { { IconButton(onClick = { show = !show }) { Icon(if (show) Icons.Default.VisibilityOff else Icons.Default.Visibility, if (show) "Hide" else "Show", tint = T.muted) } } } else null,
            keyboardOptions = KeyboardOptions(keyboardType = type),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = T.accent, unfocusedBorderColor = T.line2, focusedContainerColor = T.surface, unfocusedContainerColor = T.surface,
                cursorColor = T.accent, focusedTextColor = T.text, unfocusedTextColor = T.text,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** The CRM login panel: ink with soft accent and coral glows. */
@Composable
private fun InkPanel(modifier: Modifier = Modifier, shape: RoundedCornerShape = RoundedCornerShape(20.dp), content: @Composable BoxScope.() -> Unit) {
    Box(
        modifier.clip(shape).background(T.ink).background(
            Brush.radialGradient(listOf(Color(0x664474B9), Color.Transparent), center = Offset(900f, -60f), radius = 650f),
        ).background(
            Brush.radialGradient(listOf(Color(0x33FF6B35), Color.Transparent), center = Offset(-40f, 900f), radius = 700f),
        ),
        content = content,
    )
}

// ───────────────────────── sign in ─────────────────────────

@Composable
private fun LoginScreen(api: Api, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var server by remember { mutableStateOf(api.store.server) }
    var email by remember { mutableStateOf(api.store.email ?: "") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LazyColumn(Modifier.fillMaxSize().imePadding()) {
        item {
            InkPanel(Modifier.fillMaxWidth(), RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp)) {
                Column(Modifier.statusBarsPadding().padding(start = 24.dp, end = 24.dp, top = 28.dp, bottom = 32.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(painterResource(R.drawable.stint_icon), null, Modifier.size(34.dp, 38.dp))
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text("Stint", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, lineHeight = 22.sp)
                            Text("NOTES", color = Color(0xFF9AA8C4), fontSize = 11.sp, letterSpacing = 3.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                    Spacer(Modifier.height(36.dp))
                    Text("Every conversation,\nwritten down.", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.SemiBold, lineHeight = 36.sp)
                    Spacer(Modifier.height(10.dp))
                    Text("Record a talk on your phone. The CRM writes the transcript and a short summary.", color = Color(0xFF9AA8C4), fontSize = 14.sp)
                    Spacer(Modifier.height(20.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        repeat(9) { i -> Box(Modifier.weight(1f).height(5.dp).clip(CircleShape).background(if (i < 6) T.accent else if (i == 6) T.coral else Color.White.copy(alpha = 0.15f))) }
                    }
                }
            }
        }
        item {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Sign in", fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                Text("Use your CRM email and password.", color = T.muted, modifier = Modifier.offset(y = (-12).dp))
                Field(server, { server = it }, "CRM address", KeyboardType.Uri, "https://crm.example.com")
                Field(email, { email = it }, "Email", KeyboardType.Email, "you@stint.academy")
                Field(password, { password = it }, "Password", KeyboardType.Password, password = true)
                error?.let { Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(T.badBg).padding(12.dp)) {
                    Icon(Icons.Default.ErrorOutline, null, tint = T.badText, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
                    Text(it, color = T.badText, fontSize = 13.sp)
                } }
                PrimaryButton(
                    if (busy) "Signing in…" else "Sign in",
                    onClick = {
                        busy = true; error = null
                        scope.launch {
                            io { api.login(server, email, password) }.onSuccess { onDone() }.onFailure { error = it.message ?: "Couldn't reach the CRM." }
                            busy = false
                        }
                    },
                    enabled = !busy && server.isNotBlank() && email.isNotBlank() && password.isNotBlank(),
                )
            }
        }
    }
}

// ───────────────────────── home ─────────────────────────

private fun greeting() = when (LocalTime.now().hour) { in 5..11 -> "Good morning"; in 12..16 -> "Good afternoon"; else -> "Good evening" }

@Composable
private fun HomeScreen(api: Api, onOpen: (String) -> Unit, onSignOut: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val live by RecorderService.state.collectAsState()
    val problem by RecorderService.problem.collectAsState()
    var notes by remember { mutableStateOf<JSONArray?>(null) }
    var waiting by remember { mutableStateOf(UploadWorker.waiting(ctx)) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var askConsent by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var pendingNumber by remember { mutableStateOf<String?>(null) }

    fun refresh() {
        waiting = UploadWorker.waiting(ctx)
        loading = true
        scope.launch {
            io { api.notes() }.onSuccess { notes = it.optJSONArray("notes"); error = null }.onFailure {
                if ((it as? ApiError)?.code == 401) onSignOut() else error = it.message
            }
            loading = false
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { refresh() }
    // While uploads are waiting or summaries are being written, look again every 15 seconds.
    LaunchedEffect(Unit) {
        while (true) {
            delay(15_000)
            val list = notes
            val writing = list != null && (0 until list.length()).any { list.getJSONObject(it).summaryText() == null && list.getJSONObject(it).str("process_error") == null }
            if (UploadWorker.waiting(ctx).isNotEmpty() || waiting.isNotEmpty() || writing) refresh()
        }
    }

    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.RECORD_AUDIO] == true) RecorderService.start(ctx, pendingNumber)
        else RecorderService.problem.value = "Allow the microphone in Settings to record notes."
    }
    fun begin(number: String?) {
        RecorderService.problem.value = null
        pendingNumber = number
        val need = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }.filter { ContextCompat.checkSelfPermission(ctx, it) != PackageManager.PERMISSION_GRANTED }
        if (need.isEmpty()) RecorderService.start(ctx, number) else permissions.launch(need.toTypedArray())
    }

    val list = notes?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
    val today = list?.count { day(it) == LocalDate.now() } ?: 0
    val toConfirm = list?.count { it.str("status") == "Waiting to confirm" } ?: 0

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(Modifier.statusBarsPadding().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(R.drawable.stint_icon), null, Modifier.size(26.dp, 29.dp))
                Spacer(Modifier.width(8.dp))
                Text("Stint Notes", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                IconButton(onClick = { refresh() }, modifier = Modifier.size(48.dp)) {
                    if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = T.accent)
                    else Icon(Icons.Default.Refresh, "Refresh", tint = T.text2)
                }
                Box {
                    val initials = (api.store.name ?: "?").split(' ').filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1).uppercase() }
                    Box(
                        Modifier.size(48.dp).clip(CircleShape).clickable { menu = true }, contentAlignment = Alignment.Center,
                    ) {
                        Box(Modifier.size(36.dp).clip(CircleShape).background(T.accentSoft), contentAlignment = Alignment.Center) {
                            Text(initials, color = T.accentText, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                        }
                    }
                    DropdownMenu(menu, { menu = false }, containerColor = T.surface, shape = RoundedCornerShape(12.dp)) {
                        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                            Text(api.store.name ?: "", fontWeight = FontWeight.SemiBold)
                            Text(api.store.email ?: "", fontSize = 12.sp, color = T.muted)
                        }
                        HorizontalDivider(color = T.line)
                        DropdownMenuItem(
                            text = { Text("Sign out") }, leadingIcon = { Icon(Icons.Default.Logout, null) },
                            onClick = { menu = false; onSignOut() }, enabled = live == null,
                        )
                    }
                }
            }
        }
        item {
            Column(Modifier.padding(top = 4.dp, bottom = 4.dp)) {
                Text("${greeting()}, ${api.store.name?.substringBefore(' ') ?: ""}", fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
                Text(LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, d MMMM")), color = T.muted)
            }
        }
        item { RecordHero(live, onStart = { askConsent = true }, onStop = { RecorderService.stop(ctx); scope.launch { delay(500); waiting = UploadWorker.waiting(ctx) } }) }
        problem?.let { item { Notice(it, T.badBg, T.badText, Icons.Default.ErrorOutline) } }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Stat("Today", today.toString(), Modifier.weight(1f))
                Stat("To confirm", toConfirm.toString(), Modifier.weight(1f), if (toConfirm > 0) T.warnText else null)
                Stat("Uploading", waiting.size.toString(), Modifier.weight(1f), if (waiting.isNotEmpty()) T.accentText else null)
            }
        }
        if (waiting.isNotEmpty()) {
            val refused = waiting.mapNotNull { UploadWorker.errorFile(it).takeIf { e -> e.exists() }?.readText() }.firstOrNull()
            item {
                if (refused != null) Notice("The CRM refused a note: $refused", T.badBg, T.badText, Icons.Default.ErrorOutline)
                else Notice(if (waiting.size == 1) "1 note is waiting. It sends by itself when there is internet." else "${waiting.size} notes are waiting. They send by themselves when there is internet.", T.accentSoft, T.accentText, Icons.Default.CloudUpload)
            }
        }
        error?.let { item { Notice(it, T.badBg, T.badText, Icons.Default.ErrorOutline) } }

        if (list != null && list.isEmpty()) item { EmptyNotes() }
        if (list == null && error == null) items(3) { SkeletonCard() }
        list?.groupBy { day(it) }?.forEach { (d, group) ->
            item(key = "h$d") {
                Text(dayLabel(d), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = T.muted, modifier = Modifier.padding(top = 8.dp, start = 4.dp))
            }
            items(group, key = { it.getString("id") }) { n -> NoteCard(n) { onOpen(n.getString("id")) } }
        }
    }

    if (askConsent) ConsentSheet(onCancel = { askConsent = false }, onAccept = { number -> askConsent = false; begin(number) })
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier, color: Color? = null) {
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(T.surface).border(1.dp, T.line, RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 12.dp)) {
        Text(value, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = color ?: T.text)
        Text(label, fontSize = 12.sp, color = T.muted)
    }
}

@Composable
private fun Notice(text: String, bg: Color, fg: Color, icon: ImageVector) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(bg).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(10.dp))
        Text(text, color = fg, fontSize = 13.sp)
    }
}

/** The big recording card: ink panel with glows; live waveform while recording. */
@Composable
private fun RecordHero(live: RecorderService.Live?, onStart: () -> Unit, onStop: () -> Unit) {
    InkPanel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            AnimatedContent(live != null, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(150)) }, label = "rec") { recording ->
                if (!recording) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Pill("Phone mic", Color.White.copy(alpha = 0.1f), Color(0xFFC9D4EA), Icons.Default.Mic)
                    }
                    Spacer(Modifier.height(18.dp))
                    MicOrb(active = false)
                    Spacer(Modifier.height(18.dp))
                    Text("Ready to listen", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                    Text("Tap Start when the conversation begins.", color = Color(0xFF9AA8C4), fontSize = 13.sp)
                    Spacer(Modifier.height(20.dp))
                    PrimaryButton("Start Now", onStart, color = T.coral, icon = Icons.Default.GraphicEq)
                } else {
                    val l = live ?: return@AnimatedContent
                    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
                    LaunchedEffect(l) { while (true) { now = SystemClock.elapsedRealtime(); delay(250) } }
                    val secs = (now - l.startedElapsed) / 1000
                    val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(0.35f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "a")
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Row(Modifier.clip(RoundedCornerShape(50)).background(T.coral.copy(alpha = 0.18f)).padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(8.dp).alpha(pulse).clip(CircleShape).background(T.coral)); Spacer(Modifier.width(6.dp))
                                Text("Recording", color = Color(0xFFFFB396), fontSize = 12.sp, fontWeight = FontWeight.Medium)
                            }
                            Spacer(Modifier.weight(1f))
                            l.number?.let { Text(it, color = Color(0xFF9AA8C4), fontSize = 12.sp) }
                        }
                        Spacer(Modifier.height(16.dp))
                        Text("%02d:%02d".format(secs / 60, secs % 60), color = Color.White, fontSize = 52.sp, fontWeight = FontWeight.Light, letterSpacing = 2.sp)
                        Spacer(Modifier.height(8.dp))
                        Waveform(Modifier.fillMaxWidth().height(56.dp))
                        Spacer(Modifier.height(6.dp))
                        Text("Keeps recording with the screen off.", color = Color(0xFF9AA8C4), fontSize = 13.sp)
                        Spacer(Modifier.height(18.dp))
                        PrimaryButton("Stop and save", onStop, color = Color.White.copy(alpha = 0.12f), icon = Icons.Default.Stop)
                    }
                }
            }
        }
    }
}

@Composable
private fun MicOrb(active: Boolean) {
    val breathe by rememberInfiniteTransition(label = "orb").animateFloat(0.92f, 1.06f, infiniteRepeatable(tween(1800), RepeatMode.Reverse), label = "b")
    Box(Modifier.size(112.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(112.dp).scale(breathe).clip(CircleShape).background(T.accent.copy(alpha = 0.18f)))
        Box(Modifier.size(84.dp).clip(CircleShape).background(T.accent.copy(alpha = 0.3f)))
        Box(Modifier.size(60.dp).clip(CircleShape).background(T.accent), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Mic, null, tint = Color.White, modifier = Modifier.size(28.dp))
        }
    }
}

/** Live bars that follow the mic level, newest on the right. */
@Composable
private fun Waveform(modifier: Modifier) {
    val level by RecorderService.level.collectAsState()
    val bars = remember { mutableStateListOf<Float>().apply { repeat(36) { add(0.04f) } } }
    LaunchedEffect(level) { bars.removeAt(0); bars.add(level.coerceAtLeast(0.04f)) }
    val accent = T.accent
    val coral = T.coral
    Canvas(modifier) {
        val gap = 4.dp.toPx()
        val w = (size.width - gap * (bars.size - 1)) / bars.size
        bars.forEachIndexed { i, v ->
            val h = (v * size.height).coerceAtLeast(4.dp.toPx())
            val x = i * (w + gap)
            drawRoundRect(
                color = if (i >= bars.size - 4) coral else accent.copy(alpha = 0.45f + 0.55f * i / bars.size),
                topLeft = Offset(x, (size.height - h) / 2), size = Size(w, h), cornerRadius = CornerRadius(w / 2),
            )
        }
    }
}

@Composable
private fun EmptyNotes() {
    Card(padding = 24.dp) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).background(T.accentSoft), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.EventNote, null, tint = T.accentText)
        }
        Spacer(Modifier.height(12.dp))
        Text("No notes yet", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        Text("Tap Start Now during your next counselling talk. The summary appears here in a minute or two.", color = T.muted)
    }
}

@Composable
private fun SkeletonCard() {
    val a by rememberInfiniteTransition(label = "sk").animateFloat(0.4f, 0.9f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "s")
    Card {
        Box(Modifier.width(120.dp).height(10.dp).alpha(a).clip(CircleShape).background(T.surface2))
        Spacer(Modifier.height(10.dp))
        Box(Modifier.width(180.dp).height(14.dp).alpha(a).clip(CircleShape).background(T.surface2))
        Spacer(Modifier.height(8.dp))
        Box(Modifier.fillMaxWidth().height(10.dp).alpha(a).clip(CircleShape).background(T.surface2))
    }
}

private fun JSONObject.str(k: String) = optString(k).takeIf { it.isNotBlank() && it != "null" }
private fun JSONObject.person() = optJSONObject("lead")?.str("full_name") ?: optJSONObject("candidate")?.str("full_name")
private fun JSONObject.summaryText() = str("summary") ?: optJSONObject("draft")?.str("summary")
private fun JSONObject.at() = runCatching { OffsetDateTime.parse(str("called_at") ?: str("created_at")).atZoneSameInstant(ZoneId.systemDefault()) }.getOrNull()
private fun day(n: JSONObject): LocalDate = n.at()?.toLocalDate() ?: LocalDate.now()
private fun dayLabel(d: LocalDate) = when (d) {
    LocalDate.now() -> "Today"; LocalDate.now().minusDays(1) -> "Yesterday"
    else -> d.format(DateTimeFormatter.ofPattern("EEE, d MMM"))
}
private fun length(sec: Int) = if (sec < 60) "${sec}s" else "${sec / 60} min"

@Composable
private fun NoteCard(n: JSONObject, onClick: () -> Unit) {
    val who = n.person()
    Card(onClick = onClick, padding = 14.dp) {
        Row(verticalAlignment = Alignment.Top) {
            Box(Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(if (who != null) T.accentSoft else T.surface2), contentAlignment = Alignment.Center) {
                if (who != null) Text(who.split(' ').take(2).joinToString("") { it.take(1).uppercase() }, color = T.accentText, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                else Icon(Icons.Default.GraphicEq, null, tint = T.muted, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(who ?: "Conversation", fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text("${n.at()?.format(DateTimeFormatter.ofPattern("h:mm a")) ?: ""} · ${length(n.optInt("length_sec"))}", fontSize = 12.sp, color = T.muted)
                }
                Spacer(Modifier.height(2.dp))
                val s = n.summaryText()
                Text(
                    s ?: if (n.str("process_error") != null) "Couldn't write the summary yet." else "Writing the summary…",
                    maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 13.sp, lineHeight = 19.sp, color = if (s != null) T.text2 else T.muted,
                )
                Spacer(Modifier.height(8.dp))
                StatusPill(n.str("status") ?: "")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConsentSheet(onCancel: () -> Unit, onAccept: (String?) -> Unit) {
    var agreed by remember { mutableStateOf(false) }
    var number by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onCancel, containerColor = T.surface, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding().imePadding(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(T.accentSoft), contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.Mic, null, tint = T.accentText)
                }
                Spacer(Modifier.width(12.dp))
                Text("Start recording", fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            }
            Text("Your phone's mic will record this conversation. The CRM makes a transcript and a short summary.", color = T.text2)
            Notice("Phone or WhatsApp calls can interrupt the recording.", T.warnBg, T.warnText, Icons.Default.ErrorOutline)
            val shape = RoundedCornerShape(12.dp)
            Row(
                Modifier.fillMaxWidth().clip(shape).background(if (agreed) T.accentSoft else T.surface)
                    .border(BorderStroke(1.dp, if (agreed) T.accent else T.line2), shape)
                    .clickable { agreed = !agreed }.padding(horizontal = 6.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(agreed, { agreed = it }, colors = CheckboxDefaults.colors(checkedColor = T.accent, uncheckedColor = T.line2))
                Text("I told the other person this is recorded, and they agreed.", fontSize = 14.sp, fontWeight = FontWeight.Medium)
            }
            Field(number, { v -> number = v.filter { it.isDigit() || it == '+' }.take(15) }, "Their mobile (optional)", KeyboardType.Phone, "Links the note to the lead or student")
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = onCancel, shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, T.line2), modifier = Modifier.weight(1f).height(52.dp)) {
                    Text("Cancel", color = T.text, fontWeight = FontWeight.SemiBold)
                }
                PrimaryButton("Accept and record", { onAccept(number.ifBlank { null }) }, Modifier.weight(1.6f), enabled = agreed, color = T.coral)
            }
        }
    }
}

// ───────────────────────── one note ─────────────────────────

@Composable
private fun NoteScreen(api: Api, id: String, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    var note by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(id) { io { api.note(id) }.onSuccess { note = it }.onFailure { error = it.message } }
    val n = note

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row(Modifier.statusBarsPadding().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = T.text) }
                Text("Note", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        error?.let { item { Notice(it, T.badBg, T.badText, Icons.Default.ErrorOutline) } }
        if (n == null && error == null) items(2) { SkeletonCard() }
        if (n != null) {
            item {
                Column(Modifier.padding(horizontal = 4.dp)) {
                    Text(n.person() ?: "Conversation", fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
                    Text("${n.at()?.format(DateTimeFormatter.ofPattern("EEE, d MMM · h:mm a")) ?: ""} · ${length(n.optInt("length_sec"))}", color = T.muted)
                    Spacer(Modifier.height(10.dp)); StatusPill(n.str("status") ?: "")
                }
            }
            item {
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(3.dp).height(16.dp).clip(CircleShape).background(T.accent)); Spacer(Modifier.width(8.dp))
                        Text("Summary", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = T.muted)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(n.summaryText() ?: n.str("process_error") ?: "Writing the summary…", lineHeight = 22.sp)
                }
            }
            val d = n.optJSONObject("draft")
            val outcome = n.str("outcome") ?: d?.str("outcome")
            val next = n.str("follow_up") ?: d?.str("follow_up")
            if (outcome != null || next != null) item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.height(IntrinsicSize.Min)) {
                    outcome?.let { Info("Outcome", it, T.goodBg, T.goodText, Modifier.weight(1f).fillMaxHeight()) }
                    next?.let { Info("Next step", it + (d?.str("follow_up_when")?.let { w -> " · $w" } ?: ""), T.warnBg, T.warnText, Modifier.weight(1f).fillMaxHeight()) }
                }
            }
            if (n.str("status") == "Waiting to confirm") item {
                Notice("Open this person in the CRM to confirm the summary.", T.accentSoft, T.accentText, Icons.Default.Check)
            }
            val segs = n.optJSONArray("transcript")
            if (segs != null && segs.length() > 0) {
                item { Text("Transcript", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp, start = 4.dp)) }
                items((0 until segs.length()).map { segs.getJSONObject(it) }) { s -> Bubble(s) }
            }
        }
    }
}

@Composable
private fun Info(title: String, body: String, bg: Color, fg: Color, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(bg).padding(14.dp)) {
        Text(title, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = fg)
        Spacer(Modifier.height(4.dp))
        Text(body, fontSize = 14.sp, color = T.text)
    }
}

/** Transcript as a chat: speaker 1 on the left, others on the right. */
@Composable
private fun Bubble(s: JSONObject) {
    val first = s.optString("speaker") == "1"
    val ms = s.optLong("start_ms")
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (first) Alignment.Start else Alignment.End) {
        Text("Speaker ${s.optString("speaker")} · %d:%02d".format(ms / 60000, ms % 60000 / 1000), fontSize = 11.sp, color = T.muted, modifier = Modifier.padding(horizontal = 6.dp))
        Spacer(Modifier.height(3.dp))
        val shape = if (first) RoundedCornerShape(4.dp, 16.dp, 16.dp, 16.dp) else RoundedCornerShape(16.dp, 4.dp, 16.dp, 16.dp)
        Text(
            s.optString("text"), fontSize = 14.sp, lineHeight = 21.sp,
            modifier = Modifier.fillMaxWidth(0.85f).wrapContentWidth(if (first) Alignment.Start else Alignment.End)
                .clip(shape).background(if (first) T.surface else T.accentSoft)
                .then(if (first) Modifier.border(1.dp, T.line, shape) else Modifier).padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}
