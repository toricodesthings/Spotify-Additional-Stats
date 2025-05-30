# 🎶 Spotify Additional Stats API

## Introduction

This is a Node.js API backend designed to retrieve two publicly available Spotify statistics not directly accessible via the official Spotify Web API:

-  **Monthly Listeners**
-  **Per-Track Playcounts**

Originally written in Python, this translated Node.js version utilizes Playwright to scrape public data directly from Spotify's public web interface (Monthly Listeners and Playcount)

## 🌟 Key Features

- **Automated Scraping**: Leverages Playwright for headless browsing and data extraction.
- **Self-Hosted HTTPS Server**: Temporarily uses a self-managed HTTPS server setup as a DIY solution during the learning phase of reverse proxy configurations.
- **Dockerized Deployment**: Easily deployable in Docker containers, suitable for hosting on platforms like Render or any Docker-supported environments.
- **Efficient Resource Handling**: Implements caching and resource blocking to optimize scraping performance.

## 🚀 Getting Started

### Installation

Clone the repository:

```bash
git clone https://github.com/yourusername/spotify-additional-stats.git
cd spotify-additional-stats
```

Install dependencies:

```bash
npm install
```

### Running the Server


Start your server locally with (or use the given run_server.bat):

```bash
node server.js
```

Note: It is heavily recommended to use some sort of Reverse Proxy if you want to host it on your own machine with global access. Caddy is recommended for automatic HTTPS configuration.

Or build and run with Docker:

```bash
docker build -t spotify-stats .
docker run --ipc=host -p 9001:9001 spotify-stats
```

## 📡 API Endpoints

Retrieve data easily using the following endpoints:

- **Monthly Listeners**:

```
GET /get/monthly-listeners/{artistId}
```

- **Track Playcount**:

```
GET /get/playcount/{trackId}
```

Replace `{artistId}` or `{trackId}` with the Spotify URIs obtained from Spotify.

### Obtaining Spotify URIs

1. Navigate to Spotify Web or Desktop App.
2. Find the desired artist or track.
3. Right-click the artist/track > `Share` > `Copy Spotify URI`.
4. Paste and remove the prefix (`spotify:artist:` or `spotify:track:`), keeping only the unique identifier.

Example:

```
spotify:artist:XXXXXXXXXXXXXXXXXXXX
```

Becomes:

```
XXXXXXXXXXXXXXXXXXXX
```

## 📋 Requirements

- Node.js (16+ recommended)
- Playwright
- Docker (optional, for containerization)

## 🛠️ To-Do

- ~Configure Reverse Proxy and remove the need for custom HTTPS server~
- Add rate-limiting

## ⚠️ Disclaimer

This project is intended strictly for **educational and data-logging purposes** only. 

## 📌 License

This project is open-source under the [MIT License](LICENSE).

