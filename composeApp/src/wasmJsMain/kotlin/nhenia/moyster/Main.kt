package nhenia.moyster

import androidx.compose.ui.ExperimentalComposeUiApi
import org.jetbrains.compose.ui.window.ComposeViewport
import kotlinx.browser.document

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    ComposeViewport(document.body!!) { MoysterApp() }
}
