import { useEffect, useRef, useState } from "react"
import OysterFinder from "./OysterFinder"

const animationBase = "https://media.githubusercontent.com/media/nhenia/moyster/main/assets/moyster-session/"

type Artwork = {
  src: string
  title: string
  note: string
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const artworks: Artwork[] = [
  {
    src: "/art/oyster-wall.png",
    title: "The Oyster Wall",
    note: "Ink, paper, appetite",
  },
  {
    src: "/art/beer-and-shells.jpg",
    title: "Shuck & Destroy",
    note: "Beer, shells, repeat",
  },
  {
    src: "/art/cravings.jpg",
    title: "Oyster Cravings",
    note: "Fresh and wild",
  },
  {
    src: "/art/maritime-map.jpg",
    title: "Maritime Map",
    note: "Follow the brine",
  },
  { src: "/art/shuck-it-all.jpg", title: "Shuck It All", note: "Dive in" },
  { src: "/art/pry-it-open.jpg", title: "Pry It Open", note: "Shuck or die" },
  {
    src: "/art/salty-shell.jpg",
    title: "The Salty Shell",
    note: "Adventures near you",
  },
  { src: "/art/shuck-or-die.jpg", title: "Cold Beer", note: "Dirty seafood" },
  { src: "/art/raw-and-dirty.jpg", title: "Raw & Dirty", note: "Spill it" },
  {
    src: "/art/bad-decisions.jpg",
    title: "Bad Decisions",
    note: "Oyster punk",
  },
]

function TapeStar({ pink = false }: { pink?: boolean }) {
  return (
    <span className={`tape-star ${pink ? "pink" : ""}`} aria-hidden="true">
      ★
    </span>
  )
}

export default function App() {
  const [heroIndex, setHeroIndex] = useState(0)
  const [selected, setSelected] = useState<Artwork | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  )
  const heroRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    window.addEventListener("beforeinstallprompt", onInstall)
    return () => window.removeEventListener("beforeinstallprompt", onInstall)
  }, [])

  useEffect(() => {
    if (!selected) return
    const close = (event: KeyboardEvent) =>
      event.key === "Escape" && setSelected(null)
    window.addEventListener("keydown", close)
    document.body.classList.add("modal-open")
    return () => {
      window.removeEventListener("keydown", close)
      document.body.classList.remove("modal-open")
    }
  }, [selected])

  const tiltHero = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / bounds.width - 0.5
    const y = (event.clientY - bounds.top) / bounds.height - 0.5
    event.currentTarget.style.setProperty("--rx", `${y * -5}deg`)
    event.currentTarget.style.setProperty("--ry", `${x * 6}deg`)
    event.currentTarget.style.setProperty("--mx", `${(x + 0.5) * 100}%`)
    event.currentTarget.style.setProperty("--my", `${(y + 0.5) * 100}%`)
  }

  const resetTilt = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty("--rx", "0deg")
    event.currentTarget.style.setProperty("--ry", "0deg")
  }

  const shuffle = () => {
    setHeroIndex((current) => {
      let next = current
      while (next === current)
        next = Math.floor(Math.random() * artworks.length)
      return next
    })
    heroRef.current?.animate(
      [
        { transform: "rotate(-1deg) scale(.97)", filter: "contrast(1.2)" },
        { transform: "rotate(.6deg) scale(1.015)", filter: "contrast(1)" },
        { transform: "rotate(0) scale(1)", filter: "contrast(1)" },
      ],
      { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" },
    )
  }

  const install = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Shuck home">
          SHUCK<span>.</span>
        </a>
        <button
          className="menu-toggle"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-label="Toggle navigation"
        >
          <i />
          <i />
        </button>
        <nav className={menuOpen ? "open" : ""} aria-label="Primary navigation">
          <a href="#work" onClick={() => setMenuOpen(false)}>
            The work
          </a>
          <a href="#finder" onClick={() => setMenuOpen(false)}>
            Find oysters
          </a>
          <a href="#manifesto" onClick={() => setMenuOpen(false)}>
            Manifesto
          </a>
          <button onClick={shuffle}>Shuffle the deck</button>
          {installPrompt && <button onClick={install}>Install app</button>}
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <img className="moyster-animation moyster-animation-hero" src={`${animationBase}01_oyster_pulse.webp`} alt="" aria-hidden="true" />
          <p className="eyebrow">An oyster-fuelled art journal / Vol. 01</p>
          <h1>
            RAW.
            <br />
            LOUD.
            <br />
            <em>UNAPOLOGETIC.</em>
          </h1>
          <div className="hero-bottom">
            <p>
              A messy love letter to cold beer, salty shells and the beautiful
              bad decisions in between.
            </p>
            <button
              className="round-button"
              onClick={shuffle}
              aria-label="Shuffle the artwork"
            >
              <span>SHUFFLE</span>
              <b aria-hidden="true">↗</b>
            </button>
          </div>
          <span className="scribble-arrow" aria-hidden="true">
            ↝
          </span>
        </div>

        <div
          className="hero-stage"
          onPointerMove={tiltHero}
          onPointerLeave={resetTilt}
          ref={heroRef}
        >
          <div className="poster poster-back-one" aria-hidden="true">
            <img src={artworks[(heroIndex + 2) % artworks.length].src} alt="" />
          </div>
          <div className="poster poster-back-two" aria-hidden="true">
            <img src={artworks[(heroIndex + 1) % artworks.length].src} alt="" />
          </div>
          <button
            className="poster poster-main"
            onClick={() => setSelected(artworks[heroIndex])}
          >
            <img
              key={artworks[heroIndex].src}
              src={artworks[heroIndex].src}
              alt={artworks[heroIndex].title}
            />
            <span className="poster-label">
              {String(heroIndex + 1).padStart(2, "0")} /{" "}
              {artworks[heroIndex].title}
            </span>
          </button>
          <TapeStar pink />
          <span className="kiss" aria-hidden="true">
            KISS!
          </span>
        </div>

        <div className="scroll-note" aria-hidden="true">
          <span>SCROLL TO SHUCK</span>
          <i />
        </div>
      </section>

      <section className="marquee" aria-label="Manifesto">
        <img className="moyster-animation moyster-animation-marquee" src={`${animationBase}02_shell_flip.webp`} alt="" aria-hidden="true" />
        <div>
          SHUCK — DRINK — WANDER — REPEAT — SHUCK — DRINK — WANDER — REPEAT —
        </div>
      </section>

      <OysterFinder />

      <section className="work" id="work">
        <header className="section-heading">
          <div>
            <p className="eyebrow">Fresh from the wall</p>
            <h2>
              THE DIRTY DOZEN<span>*</span>
            </h2>
          </div>
          <p className="section-number">01—10</p>
        </header>
        <div className="art-grid">
          {artworks.map((artwork, index) => (
            <button
              className={`art-card card-${index + 1}`}
              key={artwork.src}
              onClick={() => setSelected(artwork)}
              onPointerMove={tiltHero}
              onPointerLeave={resetTilt}
            >
              <figure>
                <img
                  src={artwork.src}
                  alt={artwork.title}
                  loading={index > 2 ? "lazy" : "eager"}
                />
                <figcaption>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{artwork.title}</strong>
                    <small>{artwork.note}</small>
                  </div>
                  <b aria-hidden="true">↗</b>
                </figcaption>
              </figure>
            </button>
          ))}
        </div>
      </section>

      <section className="manifesto" id="manifesto">
        <div className="manifesto-art">
          <img src="/art/shuck-or-die.jpg" alt="" loading="lazy" />
        </div>
        <div className="manifesto-copy">
          <p className="eyebrow">The house rules</p>
          <TapeStar pink />
          <blockquote>
            “NO WHITE TABLECLOTHS.
            <br />
            NO TINY FORKS.
            <br />
            <em>NO PRETENDING.”</em>
          </blockquote>
          <p className="manifesto-aside">... BUT SOMETIMES TINY FORKS.</p>
          <p>
            We like our oysters cold, our beer colder, and our art with the
            edges left rough. Come as you are. Leave the shell fragments on the
            floor.
          </p>
          <button onClick={shuffle} className="tape-button">
            SHUCK ANOTHER →
          </button>
        </div>
      </section>

      <footer>
        <div className="footer-mark">
          SHUCK IT, NERD<span>!</span>
        </div>
        <div className="footer-meta">
          <p>RAW / SALTY / WILD</p>
          <p>MADE FOR BAD DECISIONS</p>
          <a href="#top">BACK TO TOP ↑</a>
        </div>
      </footer>

      {selected && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={selected.title}
        >
          <button
            className="lightbox-backdrop"
            onClick={() => setSelected(null)}
            aria-label="Close"
          />
          <div className="lightbox-card">
            <img src={selected.src} alt={selected.title} />
            <div>
              <p>
                {selected.title} <small>/ {selected.note}</small>
              </p>
              <button onClick={() => setSelected(null)}>CLOSE ×</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
