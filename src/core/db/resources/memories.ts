import type Database from "better-sqlite3";

export interface MemoryRecord {
  id: number;
  jid: string;
  content: string;
  tags: string[];
  createdAt: string;
}

export interface MemorySearchResult extends MemoryRecord {
  distance: number;
}

export interface MemoriesLocalResource {
  insert: (jid: string, content: string, tags: string[], embedding: number[]) => number;
  searchFull: (jid: string, embedding: number[], limit?: number) => MemorySearchResult[];
  delete: (jid: string, id: number) => boolean;
}

export const createMemoriesLocalResource = (db: Database.Database): MemoriesLocalResource => {
  const insertStmt = db.prepare("INSERT INTO memories (jid, content, tags) VALUES (?, ?, ?)");
  const insertVecStmt = db.prepare("INSERT INTO vec_memories (memory_id, jid, embedding) VALUES (?, ?, ?)");

  const deleteMemStmt = db.prepare("DELETE FROM memories WHERE id = ? AND jid = ?");
  const deleteVecStmt = db.prepare("DELETE FROM vec_memories WHERE memory_id = ?");

  const searchFullStmt = db.prepare(`
    SELECT m.id, m.jid, m.content, m.tags, m.created_at as createdAt, v.distance
    FROM vec_memories v
    JOIN memories m ON m.id = v.memory_id
    WHERE v.embedding MATCH ? AND k = ? AND v.jid = ?
    ORDER BY v.distance
  `);

  const deleteTransaction = db.transaction((jid: string, id: number) => {
    const info = deleteMemStmt.run(id, jid);
    if (info.changes > 0) {
      deleteVecStmt.run(BigInt(id));
      return true;
    }
    return false;
  });

  const insertTransaction = db.transaction((jid: string, content: string, tags: string, embeddingBuffer: Float32Array) => {
    const info = insertStmt.run(jid, content, tags);
    const memoryId = info.lastInsertRowid;
    insertVecStmt.run(BigInt(memoryId), jid, embeddingBuffer);
    return memoryId as number;
  });

  return {
    insert: (jid, content, tags, embedding) => {
      const tagsJson = JSON.stringify(tags);
      const embeddingBuffer = new Float32Array(embedding);
      return insertTransaction(jid, content, tagsJson, embeddingBuffer);
    },
    delete: (jid, id) => deleteTransaction(jid, id),
    searchFull: (jid, embedding, limit = 10) => {
      const embeddingBuffer = new Float32Array(embedding);
      const results = searchFullStmt.all(embeddingBuffer, limit, jid) as Array<{
        id: number;
        jid: string;
        content: string;
        tags: string;
        createdAt: string;
        distance: number;
      }>;

      return results.map((row) => ({
        id: row.id,
        jid: row.jid,
        content: row.content,
        tags: JSON.parse(row.tags) as string[],
        createdAt: row.createdAt,
        distance: row.distance,
      }));
    },
  };
};
