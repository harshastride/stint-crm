package academy.stint.notes

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** The CRM's colour tokens (app/globals.css), light and dark. */
@Immutable
data class Tokens(
    val bg: Color, val surface: Color, val surface2: Color, val line: Color, val line2: Color,
    val text: Color, val text2: Color, val muted: Color, val accent: Color, val accentText: Color, val accentSoft: Color,
    val ink: Color, val coral: Color,
    val badBg: Color, val badText: Color, val warnBg: Color, val warnText: Color, val goodBg: Color, val goodText: Color,
)

private val Light = Tokens(
    bg = Color(0xFFF7F8FA), surface = Color(0xFFFFFFFF), surface2 = Color(0xFFF2F4F7), line = Color(0xFFE6E9EF), line2 = Color(0xFFD3D9E3),
    text = Color(0xFF0F2545), text2 = Color(0xFF44506A), muted = Color(0xFF5F6B7E), accent = Color(0xFF4474B9), accentText = Color(0xFF2F5C9E), accentSoft = Color(0xFFEAF2FB),
    ink = Color(0xFF0F2545), coral = Color(0xFFFF6B35),
    badBg = Color(0xFFFDECEA), badText = Color(0xFFA12B1B), warnBg = Color(0xFFFFF3DF), warnText = Color(0xFF8A4B00), goodBg = Color(0xFFE6F4EC), goodText = Color(0xFF1D6B3E),
)

private val Dark = Tokens(
    bg = Color(0xFF0B1220), surface = Color(0xFF121A2B), surface2 = Color(0xFF1B2538), line = Color(0xFF263247), line2 = Color(0xFF384765),
    text = Color(0xFFE8EDF6), text2 = Color(0xFFB7C2D6), muted = Color(0xFF94A1B8), accent = Color(0xFF4474B9), accentText = Color(0xFF9CC2F2), accentSoft = Color(0xFF1C2D4A),
    ink = Color(0xFF0F2545), coral = Color(0xFFFF6B35),
    badBg = Color(0xFF3B1D1B), badText = Color(0xFFFFA194), warnBg = Color(0xFF3A2B12), warnText = Color(0xFFF3C27A), goodBg = Color(0xFF14301F), goodText = Color(0xFF86D9A8),
)

val LocalTokens = staticCompositionLocalOf { Light }
val T: Tokens @Composable get() = LocalTokens.current

val Poppins = FontFamily(
    Font(R.font.poppins_regular, FontWeight.Normal),
    Font(R.font.poppins_medium, FontWeight.Medium),
    Font(R.font.poppins_semibold, FontWeight.SemiBold),
    Font(R.font.poppins_bold, FontWeight.Bold),
)

@Composable
fun StintTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val t = if (dark) Dark else Light
    val base = TextStyle(fontFamily = Poppins) // colour comes from LocalContentColor, so buttons can turn text white
    val type = Typography().run {
        copy(
            displayLarge = displayLarge.merge(base), displayMedium = displayMedium.merge(base), displaySmall = displaySmall.merge(base),
            headlineLarge = headlineLarge.merge(base), headlineMedium = headlineMedium.merge(base), headlineSmall = headlineSmall.merge(base),
            titleLarge = titleLarge.merge(base), titleMedium = titleMedium.merge(base), titleSmall = titleSmall.merge(base),
            bodyLarge = bodyLarge.merge(base).copy(fontSize = 15.sp), bodyMedium = bodyMedium.merge(base).copy(fontSize = 14.sp), bodySmall = bodySmall.merge(base),
            labelLarge = labelLarge.merge(base).copy(fontWeight = FontWeight.SemiBold), labelMedium = labelMedium.merge(base), labelSmall = labelSmall.merge(base),
        )
    }
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = t.accent, onPrimary = Color.White, secondary = t.coral, background = t.bg, surface = t.surface,
        surfaceContainer = t.surface, surfaceContainerLow = t.surface, surfaceContainerHigh = t.surface, onSurface = t.text,
        onSurfaceVariant = t.muted, outline = t.line2, outlineVariant = t.line, error = t.badText,
    )
    CompositionLocalProvider(LocalTokens provides t, LocalContentColor provides t.text) {
        MaterialTheme(colorScheme = scheme, typography = type, content = content)
    }
}
