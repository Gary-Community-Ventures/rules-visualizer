//> using scala 3.3.6
//> using repository ivy2Local
//> using dep gov.irs::factgraph:3.1.0-SNAPSHOT
//> using dep com.lihaoyi::upickle:3.3.1
//> using dep org.scala-lang.modules::scala-xml:2.3.0

/* JVM harness for the bench: loads a fact-graph XML, builds the dictionary
 * + graph against the JVM build of `gov.irs:factgraph`, runs N executes
 * against one tests.json case, prints a JSON timing summary to stdout.
 *
 * Mirrors the shape of the JS worker at scripts/bench-engines/worker.ts
 * so the orchestrator (run.ts) can spawn it as just another engine.
 *
 * Each invocation is a fresh JVM; cold time captures startup + class
 * load + dictionary parse. The orchestrator gives generous warmup so JIT
 * settles in before timed executes.
 */
package factgraph_jvm_bench

import gov.irs.factgraph.{FactDictionary, Graph, Path}
import gov.irs.factgraph.compnodes.*
import gov.irs.factgraph.persisters.InMemoryPersister
import gov.irs.factgraph.types.*

import java.util.UUID
import scala.io.Source
import scala.util.matching.Regex
import scala.xml.XML

object Harness:
  /** Resolve a caret-prefixed dependency path against its host fact's path.
    *
    * Mirrors `resolvePaths` in `packages/factgraph-core/src/parser.ts:757`:
    *  - `^`         pops one path segment from the host
    *  - `^^`        pops two
    *  - `^/X`       pops one, then appends `/X`
    *  - `^^/X`      pops two, then appends `/X`
    *
    * The caret syntax is a Gary-Community-Ventures extension to fact-graph
    * (the upstream IRS engine doesn't know it). Our JS parser rewrites
    * caret paths to absolute before handing the digest to the Scala.js
    * bundle, and our Rust interpreter handles it natively via a scope
    * stack. The JVM engine speaks raw fact-graph and fails freeze() on
    * any unresolved caret path — so we pre-rewrite the XML here. */
  private def resolveCaret(depPath: String, hostPath: String): String =
    val slashIdx = depPath.indexOf('/')
    val (head, tail) =
      if slashIdx == -1 then (depPath, "")
      else (depPath.substring(0, slashIdx), depPath.substring(slashIdx + 1))
    val segs = scala.collection.mutable.ArrayBuffer.from(
      hostPath.split('/').filter(_.nonEmpty)
    )
    for _ <- 0 until head.length do
      if segs.nonEmpty then segs.remove(segs.length - 1)
    val base = if segs.isEmpty then "" else "/" + segs.mkString("/")
    if tail.isEmpty then (if base.isEmpty then "/" else base)
    else (if base.isEmpty then "" else base) + "/" + tail

  /** Rewrite every caret-prefixed `path="…"` in the XML to an absolute path,
    * resolved against the enclosing `<Fact path="…">`. Operates at the
    * string level because fact-graph XML doesn't nest `<Fact>` and the
    * positions are easy to enumerate.
    *
    * Returns a new XML string with no caret paths; the upstream engine
    * can then process it without modification. */
  private def rewriteCaretPaths(xml: String): String =
    // Accept either `path="..."` or `path='...'`. Direct File's tax XMLs
    // mix the two; SNAP rulesets use double-quotes. Multiline-tolerant
    // so an open-tag split across lines still matches.
    val factOpenRe: Regex = """(?s)<Fact\s+[^>]*?path=(["'])([^"']+)\1[^>]*>""".r
    val caretAttrRe: Regex = """path=(["'])(\^[^"']*)\1""".r
    val opens = factOpenRe.findAllMatchIn(xml).toList
    val closes = "</Fact>".r.findAllMatchIn(xml).map(_.start).toList
    if opens.length != closes.length then
      sys.error(s"caret-rewrite: ${opens.length} <Fact> opens vs ${closes.length} </Fact> closes")
    val sb = new StringBuilder(xml)
    for ((open, closeStart) <- opens.zip(closes).reverse) do
      val host = open.group(2)
      val bodyStart = open.end
      val bodyEnd = closeStart
      val body = sb.substring(bodyStart, bodyEnd)
      val newBody = caretAttrRe.replaceAllIn(
        body,
        m =>
          val quote = m.group(1)
          val raw = m.group(2)
          Regex.quoteReplacement(s"""path=${quote}${resolveCaret(raw, host)}${quote}""")
      )
      if newBody != body then sb.replace(bodyStart, bodyEnd, newBody)
    sb.toString

  private def coerce(dict: FactDictionary, path: String, v: ujson.Value): WritableType =
    val defn = dict.getDefinition(path)
    val nodeKind: Option[CompNode] = if defn == null then None else Some(defn.value)
    (nodeKind, v) match
      case (Some(_: DollarNode), ujson.Num(n))   => Dollar(BigDecimal(n))
      case (Some(_: IntNode), ujson.Num(n))      => n.toInt
      case (Some(_: BooleanNode), ujson.Bool(b)) => b
      case (Some(_: StringNode), ujson.Str(s))   => s
      case (Some(_: DayNode), ujson.Str(s))      => Day(java.time.LocalDate.parse(s))
      case (Some(e: EnumNode), ujson.Str(s))     => Enum(Some(s), e.enumOptionsPath)
      // Best-effort fallbacks when dictionary doesn't recognize the path
      // (e.g. /members/*/foo before we splice in the UUID). Match by JSON shape.
      case (_, ujson.Num(n))  => Dollar(BigDecimal(n)) // most SNAP scalars are dollars
      case (_, ujson.Bool(b)) => b
      case (_, ujson.Str(s))  => s
      case other              => throw new RuntimeException(s"coerce: cannot map $other at $path")

  def main(args: Array[String]): Unit =
    val argMap = args
      .flatMap(a => "^--([^=]+)=(.*)$".r.findFirstMatchIn(a).map(m => m.group(1) -> m.group(2)))
      .toMap
    val xmlPath = argMap("xml")
    val testsJsonPath = argMap("tests-json")
    val ruleset = argMap.getOrElse("ruleset", "?")
    val caseIndex = argMap.getOrElse("case-index", "0").toInt
    val count = argMap.getOrElse("count", "100").toInt
    val warmup = argMap.getOrElse("warmup", "5").toInt

    val coldT = System.nanoTime()

    val rawXml = Source.fromFile(xmlPath).getLines().mkString("\n")
    // Rewrite `^` paths to absolute. Enough to get past freeze() on
    // rulesets like snap-complete that the upstream engine would
    // otherwise reject for "cannot find fact at path '^'". Note: the
    // rewrite is a NECESSARY but NOT SUFFICIENT fix — see the bench
    // README's compatibility section for why snap-complete still hangs
    // the JVM build after the rewrite (Scala.js's single-threaded lazy
    // vals silently tolerate a cycle in the dependency graph that the
    // JVM's multi-thread-safe lazy vals park on).
    val rewritten = rewriteCaretPaths(rawXml)
    val xml = XML.loadString(rewritten)
    val dict = FactDictionary.fromXml(xml)

    val testsJson = ujson.read(Source.fromFile(testsJsonPath).getLines().mkString("\n"))
    val test = testsJson.arr(caseIndex)
    val rawInputs = test.obj.get("inputs").map(_.obj).getOrElse(scala.collection.mutable.LinkedHashMap.empty[String, ujson.Value])
    val rawEntities = test.obj.get("entities").map(_.obj).getOrElse(scala.collection.mutable.LinkedHashMap.empty[String, ujson.Value])

    val seeds = scala.collection.mutable.LinkedHashMap[String, WritableType]()

    // Collections: build a per-collection UUID list and translate
    // "/members/*/age" → "/members/#$uuid/age" per member row.
    for (collectionPath, membersJ) <- rawEntities do
      val members = membersJ.arr
      val uuids = members.indices.map(_ => UUID.randomUUID()).toVector
      seeds(collectionPath) = Collection(uuids)
      for (memberObj, uuid) <- members.zip(uuids) do
        for (fieldKey, value) <- memberObj.obj do
          val fieldPath = fieldKey.replace("/*/", s"/#$uuid/")
          seeds(fieldPath) = coerce(dict, fieldPath, value)

    // Scalar inputs
    for (path, value) <- rawInputs do
      seeds(path) = coerce(dict, path, value)

    val persister = InMemoryPersister(seeds.toSeq*)
    val graph = Graph(dict, persister)

    // Read paths: every definition. Matches the JS engine apples-to-apples
    // (the JS executor walks the whole graph state for the visualizer too).
    val pathsToRead: Vector[String] =
      dict.getPaths().iterator.map(_.toString).toVector

    val coldMs = (System.nanoTime() - coldT).toDouble / 1e6

    // Warmup
    var i = 0
    while i < warmup do
      var j = 0
      while j < pathsToRead.length do
        if pathsToRead(j).contains("*") then graph.getVect(Path(pathsToRead(j)))
        else graph.get(Path(pathsToRead(j)))
        j += 1
      i += 1

    // Timed executes
    val durations = new Array[Double](count)
    val t0 = System.nanoTime()
    i = 0
    while i < count do
      val s = System.nanoTime()
      var j = 0
      while j < pathsToRead.length do
        if pathsToRead(j).contains("*") then graph.getVect(Path(pathsToRead(j)))
        else graph.get(Path(pathsToRead(j)))
        j += 1
      durations(i) = (System.nanoTime() - s).toDouble / 1e6
      i += 1
    val totalMs = (System.nanoTime() - t0).toDouble / 1e6

    val sorted = durations.sorted
    val mean = sorted.sum / sorted.length
    def pct(p: Int): Double =
      val idx = math.min(sorted.length - 1, ((p.toDouble / 100) * sorted.length).toInt)
      sorted(idx)
    def f4(x: Double): Double = math.rint(x * 10000) / 10000
    def f3(x: Double): Double = math.rint(x * 1000) / 1000

    // Output sample: a handful of computed values so the orchestrator can
    // (optionally) cross-check correctness against other engines.
    val sample = pathsToRead
      .filter(p => p.contains("/") && !p.contains("*"))
      .take(5)
      .map(p => p -> graph.get(Path(p)).toString)
      .toMap

    val result = ujson.Obj(
      "engine" -> "jvm",
      "ruleset" -> ruleset,
      "count" -> count,
      "warmup" -> warmup,
      "caseIndex" -> caseIndex,
      "coldMs" -> f3(coldMs),
      "totalMs" -> f3(totalMs),
      "meanMs" -> f4(mean),
      "p50Ms" -> f4(pct(50)),
      "p95Ms" -> f4(pct(95)),
      "p99Ms" -> f4(pct(99)),
      "minMs" -> f4(sorted(0)),
      "maxMs" -> f4(sorted(sorted.length - 1)),
      "throughputPerSec" -> math.rint(count.toDouble / totalMs * 1000 * 10) / 10,
      "outputSample" -> ujson.Obj.from(sample.iterator.map((k, v) => k -> ujson.Str(v)))
    )
    print(result.render())
