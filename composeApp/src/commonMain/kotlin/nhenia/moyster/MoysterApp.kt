package nhenia.moyster

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock
import org.jetbrains.compose.resources.ExperimentalResourceApi
import moyster.composeapp.generated.resources.Res

private val Ink = Color(0xFF102724)
private val Cream = Color(0xFFF5F1E7)
private val Coral = Color(0xFFED674B)
private val Mint = Color(0xFFDCECE2)
private val Muted = Color(0xFF57706B)

@Serializable
data class OysterVenue(
    val id: String,
    val name: String,
    val area: String,
    val address: String,
    val kind: List<String> = emptyList(),
    val price: Double? = null,
    val unit: String = "variable",
    val deal: String = "",
    val days: List<Int> = emptyList(),
    val start: String? = null,
    val end: String? = null,
    val note: String = "",
    val source: String = ""
)

@Serializable data class OysterDirectory(val updated: String, val venues: List<OysterVenue>)

private fun minutes(value: String?): Int =
    value?.split(":")?.let { it[0].toIntOrNull()?.times(60)?.plus(it.getOrNull(1)?.toIntOrNull() ?: 0) } ?: Int.MAX_VALUE

private fun todayAndTime(): Pair<Int, Int> {
    val local = Clock.System.now().toLocalDateTime(TimeZone.of("America/Chicago"))
    return (local.dayOfWeek.isoDayNumber % 7) to (local.hour * 60 + local.minute)
}

private fun scheduled(venue: OysterVenue) = venue.days.isNotEmpty() && venue.start != null && venue.end != null

private fun timeLabel(value: String): String {
    val hour = value.substringBefore(":").toInt()
    val minute = value.substringAfter(":").toInt()
    return "${if (hour % 12 == 0) 12 else hour % 12}${if (minute == 0) "" else ":${minute.toString().padStart(2, '0')}"}${if (hour >= 12) "pm" else "am"}"
}

private fun daysLabel(days: List<Int>): String = when {
    days.size == 7 -> "Every day"
    days == listOf(1, 2, 3, 4, 5) -> "Mon–Fri"
    days == listOf(1, 2, 3, 4) -> "Mon–Thu"
    else -> days.joinToString(" · ") { listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")[it] }
}

private fun priceLabel(v: OysterVenue): String = when {
    v.price == null -> "Special"
    v.unit == "half-dozen" -> "$${v.price} / 6"
    else -> "$${v.price} / oyster"
}

@OptIn(ExperimentalResourceApi::class)
@Composable
fun MoysterApp() {
    var directory by remember { mutableStateOf<OysterDirectory?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        try {
            directory = Json { ignoreUnknownKeys = true }.decodeFromString<OysterDirectory>(
                Res.readBytes("files/deals.json").decodeToString()
            )
        } catch (t: Throwable) {
            error = "Unable to load the oyster directory."
        }
    }
    var query by remember { mutableStateOf("") }
    var specialsOnly by remember { mutableStateOf(false) }
    var todayOnly by remember { mutableStateOf(false) }
    var nowOnly by remember { mutableStateOf(false) }
    var area by remember { mutableStateOf("All neighborhoods") }
    var style by remember { mutableStateOf("Any style") }
    var sort by remember { mutableStateOf("A–Z") }
    val clock = todayAndTime()
    val venues = directory?.venues.orEmpty()
    val areas = remember(venues) { listOf("All neighborhoods") + venues.map { it.area }.distinct().sorted() }
    val results = venues.filter { v ->
        val term = query.trim()
        (term.isEmpty() || listOf(v.name, v.area, v.address, v.deal).plus(v.kind).any {
            it.contains(term, ignoreCase = true)
        }) &&
        (area == "All neighborhoods" || v.area == area) &&
        (style == "Any style" || v.kind.contains(style.lowercase())) &&
        (!specialsOnly || scheduled(v)) &&
        (!todayOnly || v.days.contains(clock.first)) &&
        (!nowOnly || (v.days.contains(clock.first) && scheduled(v) &&
            clock.second >= minutes(v.start) && clock.second < minutes(v.end)))
    }.let { filtered ->
        when (sort) {
            "Lowest price" -> filtered.sortedWith(compareBy<OysterVenue> {
                if (it.price == null) Double.MAX_VALUE
                else if (it.unit == "half-dozen") it.price / 6 else it.price
            }.thenBy { it.name })
            "Earliest deal" -> filtered.sortedWith(compareBy<OysterVenue> { minutes(it.start) }.thenBy { it.name })
            else -> filtered.sortedBy { it.name }
        }
    }

    MaterialTheme(colorScheme = lightColorScheme(primary = Ink, secondary = Coral, background = Cream, surface = Color.White)) {
        LazyColumn(modifier = Modifier.fillMaxSize().background(Cream)) {
            item {
                Column(Modifier.fillMaxWidth().background(Ink).padding(24.dp)) {
                    Text("moyster.", fontSize = 36.sp, fontFamily = FontFamily.Serif, color = Color.White, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(36.dp))
                    Text("THE CITY'S SHELLFISH FIELD GUIDE", fontSize = 11.sp, letterSpacing = 2.sp, color = Mint)
                    Spacer(Modifier.height(14.dp))
                    Text("Find your", fontFamily = FontFamily.Serif, fontSize = 49.sp, lineHeight = 52.sp, color = Color.White)
                    Text("half shell.", fontFamily = FontFamily.Serif, fontSize = 52.sp, lineHeight = 54.sp, color = Coral)
                    Spacer(Modifier.height(16.dp))
                    Text("Raw, chargrilled, by the dozen. The good stuff, all across New Orleans.", color = Mint, fontSize = 14.sp)
                    Spacer(Modifier.height(16.dp))
                }
            }
            item {
                Column(Modifier.padding(18.dp)) {
                    OutlinedTextField(
                        value = query, onValueChange = { query = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Search restaurants, oysters, neighborhoods") },
                        singleLine = true, shape = RoundedCornerShape(12.dp)
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !specialsOnly, onClick = { specialsOnly = false }, label = { Text("All oysters") })
                        FilterChip(selected = specialsOnly, onClick = { specialsOnly = true }, label = { Text("Happy hours") })
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = todayOnly, onClick = { todayOnly = !todayOnly }, label = { Text("Deals today") })
                        FilterChip(selected = nowOnly, onClick = { nowOnly = !nowOnly }, label = { Text("On now") })
                    }
                    FilterSelector("Neighborhood", area, areas) { area = it }
                    FilterSelector("Preparation", style, listOf("Any style", "Raw", "Chargrilled", "Fried", "Roasted")) { style = it }
                    FilterSelector("Sort", sort, listOf("A–Z", "Lowest price", "Earliest deal")) { sort = it }
                    Spacer(Modifier.height(14.dp))
                    Text(if (specialsOnly) "The happy-hour edit." else "The oyster index.",
                        fontFamily = FontFamily.Serif, fontSize = 28.sp, color = Ink)
                    Text("${results.size} places · New Orleans", color = Muted, fontSize = 13.sp)
                    directory?.let { Text("Directory snapshot: ${it.updated}", fontSize = 11.sp, color = Muted) }
                }
            }
            if (error != null) item { Text(error!!, Modifier.padding(24.dp), color = Coral) }
            if (directory != null && results.isEmpty()) item {
                Text("No oysters match these filters.", Modifier.padding(24.dp), color = Muted)
            }
            items(results, key = { it.id }) { venue ->
                VenueCard(venue, Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp))
            }
            item {
                Text("Published schedules are not real-time availability. Confirm prices and opening hours with each restaurant.",
                    Modifier.padding(24.dp), color = Muted, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun FilterSelector(label: String, selection: String, options: List<String>, choose: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("$label:", modifier = Modifier.width(122.dp), fontSize = 13.sp, color = Muted)
        Box {
            TextButton(onClick = { expanded = true }) { Text("$selection ▾", maxLines = 1, overflow = TextOverflow.Ellipsis) }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { option ->
                    DropdownMenuItem(text = { Text(option) }, onClick = { choose(option); expanded = false })
                }
            }
        }
    }
}

@Composable
private fun VenueCard(venue: OysterVenue, modifier: Modifier = Modifier) {
    val uriHandler = LocalUriHandler.current
    val hasSpecial = scheduled(venue)
    Card(modifier, colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(14.dp)) {
        Column(Modifier.fillMaxWidth().padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()) {
                Text(venue.area.uppercase(), color = Muted, fontSize = 10.sp, letterSpacing = 1.sp)
                Surface(color = if (hasSpecial) Mint else Cream, shape = RoundedCornerShape(20.dp)) {
                    Text(if (hasSpecial) "HAPPY HOUR" else "OYSTER SPOT", Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                        color = Ink, fontSize = 10.sp)
                }
            }
            Spacer(Modifier.height(18.dp))
            Text(venue.name, fontFamily = FontFamily.Serif, fontSize = 27.sp, lineHeight = 30.sp, color = Ink)
            Text(venue.address, color = Muted, fontSize = 12.sp)
            HorizontalDivider(Modifier.padding(vertical = 14.dp), color = Cream)
            Text(if (hasSpecial) priceLabel(venue) else "Explore menu", fontWeight = FontWeight.Bold, fontSize = 19.sp, color = Ink)
            Spacer(Modifier.height(4.dp))
            Text(if (hasSpecial) "${daysLabel(venue.days)} · ${timeLabel(venue.start!!)}–${timeLabel(venue.end!!)}"
                else "Oysters served · No listed happy hour", fontSize = 12.sp, color = Muted)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TextButton(onClick = { if (venue.source.isNotBlank()) uriHandler.openUri(venue.source) }) { Text("Restaurant ↗") }
                TextButton(onClick = { uriHandler.openUri("https://www.google.com/maps/search/?api=1&query=" +
                    venue.address.replace(" ", "+")) }) { Text("Directions ↗") }
            }
        }
    }
}
