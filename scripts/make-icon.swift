// Generates build/icon.png (1024×1024): swift scripts/make-icon.swift
import AppKit

let size = 1024.0
let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()
let ctx = NSGraphicsContext.current!.cgContext

// macOS icon grid: 824pt rounded square centered on 1024 canvas.
let inset = 100.0
let rect = CGRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
let path = CGPath(roundedRect: rect, cornerWidth: 185, cornerHeight: 185, transform: nil)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 30, color: NSColor.black.withAlphaComponent(0.35).cgColor)
ctx.addPath(path)
ctx.setFillColor(NSColor.black.cgColor)
ctx.fillPath()
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(path)
ctx.clip()
let colors = [NSColor(red: 0.36, green: 0.36, blue: 0.97, alpha: 1).cgColor, NSColor(red: 0.78, green: 0.28, blue: 0.91, alpha: 1).cgColor] as CFArray
let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: rect.minX, y: rect.maxY), end: CGPoint(x: rect.maxX, y: rect.minY), options: [])

// Spotlight: soft radial glow.
let glowColors = [NSColor.white.withAlphaComponent(0.55).cgColor, NSColor.white.withAlphaComponent(0).cgColor] as CFArray
let glow = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: glowColors, locations: [0, 1])!
let c = CGPoint(x: 560, y: 470)
ctx.drawRadialGradient(glow, startCenter: c, startRadius: 0, endCenter: c, endRadius: 300, options: [])

// Click ripple ring.
ctx.setStrokeColor(NSColor(red: 1, green: 0.84, blue: 0.04, alpha: 1).cgColor)
ctx.setLineWidth(26)
ctx.strokeEllipse(in: CGRect(x: c.x - 120, y: c.y - 120, width: 240, height: 240))

// Cursor arrow (tip at the ripple center).
let arrow = CGMutablePath()
let s = 1.15
let pts: [(Double, Double)] = [(0, 0), (0, -250), (62, -192), (108, -290), (150, -270), (106, -176), (186, -176)]
// Points are (dx, dy) from the tip; CoreGraphics' y axis points up, so negative dy goes down.
arrow.move(to: CGPoint(x: c.x + pts[0].0 * s, y: c.y + pts[0].1 * s))
for p in pts.dropFirst() { arrow.addLine(to: CGPoint(x: c.x + p.0 * s, y: c.y + p.1 * s)) }
arrow.closeSubpath()
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: NSColor.black.withAlphaComponent(0.4).cgColor)
ctx.addPath(arrow)
ctx.setFillColor(NSColor.white.cgColor)
ctx.fillPath()
ctx.restoreGState()
ctx.addPath(arrow)
ctx.setStrokeColor(NSColor(red: 0.1, green: 0.1, blue: 0.14, alpha: 1).cgColor)
ctx.setLineWidth(14)
ctx.setLineJoin(.round)
ctx.strokePath()
ctx.restoreGState()

img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "build/icon.png"))
